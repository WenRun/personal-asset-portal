"""大模型客户端（AI 元数据识别一期：图片 / 视频 / 书籍 / 字体）：

- 配置存 settings 表 ai_config 键（管理端「设置」页可改），**不进 .env**——
  worker 每次任务实时读库，改地址 / 换 key / 换模型保存即生效，无需重启容器。
- 协议走 OpenAI 兼容 chat completions：智谱 / 通义 / OpenAI / 局域网 Ollama 同一套，
  httpx 直连不引新依赖；视觉输入为 base64 data URL，发送前压到长边 768 的 JPEG 控成本。
- api_key 属敏感信息：读接口只回掩码（前 3 后 4），完整值仅落 settings 表与发往供应商。
"""

import base64
import io
import json
import time
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Setting

AI_CONFIG_KEY = "ai_config"

# 与前端设置页 / 探活接口共用的默认值；enabled 默认关：没配 key 就开启只会得到满屏 401
DEFAULT_AI_CONFIG: dict = {
    "enabled": False,
    "base_url": "",
    "api_key": "",
    "model": "",
    "proxy_url": "",
    "timeout_seconds": 90.0,
}

# 一期支持 AI 识别的类型（音乐二期按专辑聚合单独设计）
AI_ENRICHABLE_TYPES = ("image", "video", "book", "font")


async def get_ai_config(db: AsyncSession) -> dict:
    """读 ai_config 并补默认值（worker 每次任务调用，改动保存后立即生效）。"""
    row = await db.get(Setting, AI_CONFIG_KEY)
    cfg = dict(DEFAULT_AI_CONFIG)
    if row is not None and isinstance(row.value, dict):
        cfg.update({k: v for k, v in row.value.items() if k in DEFAULT_AI_CONFIG})
    return cfg


def save_ai_config(current: dict | None, patch: dict) -> dict:
    """合并保存：patch 中 api_key 为空表示「保持不变」（前端密码框留空）；其余字段覆盖。"""
    cfg = {**DEFAULT_AI_CONFIG, **(current or {})}
    for k in DEFAULT_AI_CONFIG:
        if k in patch and patch[k] is not None:
            if k == "api_key" and str(patch[k]).strip() == "":
                continue  # 留空 = 不改 key（掩码展示导致前端永远拿不回原文，只能这么约定）
            cfg[k] = patch[k]
    return cfg


def ai_config_ready(cfg: dict) -> tuple[bool, str]:
    """启用判定 + 缺项提示（提示直接给管理员看，要能指到设置页）。"""
    if not cfg.get("enabled"):
        return False, "AI 识别未启用（设置页打开开关）"
    missing = [n for n, v in (("接口地址", cfg.get("base_url")), ("API Key", cfg.get("api_key")), ("模型名", cfg.get("model"))) if not v]
    if missing:
        return False, f"AI 配置不完整，缺：{'、'.join(missing)}（设置页补齐后重试）"
    return True, ""


def mask_key(key: str | None) -> str:
    """api_key 掩码：前 3 后 4；太短的整段打码（哪怕泄露也不至于交出完整 key）。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return f"{key[:3]}****{key[-4:]}"


def ai_config_public_view(cfg: dict) -> dict:
    """设置读接口出参：完整 key 永不出库，只回掩码与是否已配置。"""
    return {
        "enabled": bool(cfg.get("enabled")),
        "base_url": cfg.get("base_url") or "",
        "model": cfg.get("model") or "",
        "proxy_url": cfg.get("proxy_url") or "",
        "timeout_seconds": cfg.get("timeout_seconds") or DEFAULT_AI_CONFIG["timeout_seconds"],
        "api_key_set": bool(cfg.get("api_key")),
        "api_key_masked": mask_key(cfg.get("api_key")),
    }


# ---------- OpenAI 兼容调用 ----------

class AiCallError(Exception):
    """调用失败：message 为给管理员看的中文原因（含排查提示），不带堆栈噪音。"""


class _HttpError(Exception):
    """供应商返回 4xx/5xx：带 status_code 供 error_hint 翻译。"""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def error_hint(exc: Exception) -> str:
    """把常见错误翻成大白话（用户不熟这类问题，提示要能直接指路）。"""
    if isinstance(exc, httpx.TimeoutException):
        return "请求超时：模型响应太慢或网络不通。国产供应商国内直连即可；若填了代理先确认代理存活"
    if isinstance(exc, httpx.ConnectError):
        return "连不上接口地址：检查 base_url 是否写对（要含协议头、通常到 /v4 或 /v1 这一级）、填了代理则确认代理可达"
    status = getattr(exc, "status_code", None) or _status_from_message(str(exc))
    body = str(exc)
    if status == 401 or status == 403:
        return "认证失败（401/403）：API Key 不对、没开通该模型或账户欠费"
    if status == 404:
        return "接口或模型不存在（404）：base_url 尾巴多/少了路径，或模型名拼写不对"
    if status == 429:
        return "触发限流（429）：调用太频繁或配额用完，稍等再试"
    if "image" in body.lower() or "vision" in body.lower() or "multimodal" in body.lower():
        return "该模型不支持看图：请换视觉模型（如 glm-4.5v / qwen-vl-max）"
    return body[:200]


def _status_from_message(msg: str) -> int | None:
    import re
    m = re.search(r"\b(4\d\d|5\d\d)\b", msg)
    return int(m.group(1)) if m else None


async def chat(cfg: dict, messages: list[dict], *, max_tokens: int = 1024, temperature: float = 0.2) -> tuple[str, dict]:
    """调 chat completions，返回 (正文, usage)。网络 / HTTP 错误抛 AiCallError（带大白话提示），
    由调用方决定交给任务退避重试还是落 meta。"""
    base = (cfg.get("base_url") or "").strip().rstrip("/")
    url = f"{base}/chat/completions"
    kw: dict = {"timeout": float(cfg.get("timeout_seconds") or 90), "follow_redirects": True}
    # 容错：host:port 形式自动补 http://（与刮削 _client 同款坑）；空值 = 直连
    if (proxy := (cfg.get("proxy_url") or "").strip()):
        kw["proxy"] = proxy if "://" in proxy else f"http://{proxy}"
    payload = {
        "model": cfg.get("model"),
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    try:
        async with httpx.AsyncClient(**kw) as c:
            r = await c.post(url, json=payload, headers={
                "Authorization": f"Bearer {cfg.get('api_key')}",
                "Content-Type": "application/json",
            })
            if r.status_code >= 400:
                # 错误体带供应商原始信息（如 OpenAI 的 error.message），拼进异常供提示翻译
                snippet = ""
                try:
                    snippet = str((r.json()).get("error", {}).get("message") or r.text)[:200]
                except Exception:  # noqa: BLE001
                    snippet = r.text[:200]
                raise _HttpError(r.status_code, f"HTTP {r.status_code}: {snippet}")
            data = r.json()
    except AiCallError:
        raise
    except Exception as exc:  # noqa: BLE001  翻译成大白话再抛：网络抖动交给任务退避重试
        raise AiCallError(error_hint(exc)) from exc

    try:
        content = (data["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise AiCallError(f"响应结构异常（缺少 choices[0].message.content）：{str(data)[:200]}") from exc
    usage = data.get("usage") or {}
    return content, {"prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens")}


# ---------- 结果 JSON 解析与图片编码 ----------

def parse_json_content(content: str | None) -> dict | None:
    """从模型回复里抠出 JSON 对象：容忍 ```json 围栏、前后闲话；字符串值里含花括号也吃得下
    （raw_decode 按语法解析而非数括号）；模型输出 [{...}] 数组时取第一个对象。
    解析不出返回 None（调用方按识别失败处理，不 crash）。"""
    if not content:
        return None
    text = content.strip()

    def _as_dict(seg: str) -> dict | None:
        try:
            v = json.loads(seg)
            return v if isinstance(v, dict) else None
        except Exception:  # noqa: BLE001
            return None

    # ① 整体直读（最规矩的回复）
    if (v := _as_dict(text)) is not None:
        return v
    # ② 围栏代码块（```json ... ```），容忍无语言标记
    for i, seg in enumerate(text.split("```")):
        if i % 2 == 1 and (v := _as_dict(seg.removeprefix("json").strip())) is not None:
            return v
    # ③ 从每个 { 起点做语法级解析（raw_decode 遇非法即抛，天然跳过散文与花括号噪音）
    dec = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            v, _end = dec.raw_decode(text[i:])
        except json.JSONDecodeError:
            continue
        if isinstance(v, dict):
            return v
    return None


def image_to_data_url(path: Path, max_side: int = 768) -> str | None:
    """本地图片 → 压缩后的 JPEG data URL。解码失败返回 None（该张图跳过，不拦整次识别）。"""
    try:
        from PIL import Image

        img = Image.open(path)
        img.load()
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        if max(img.size) > max_side:
            img.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/jpeg;base64,{b64}"
    except Exception:  # noqa: BLE001
        return None


def vision_messages(system: str, user_text: str, image_paths: list[Path], *, max_images: int = 3) -> list[dict]:
    """组装多模态消息：图片按顺序附加（None 的跳过），一张都编不出去也照发纯文本。"""
    content: list[dict] = [{"type": "text", "text": user_text}]
    for p in image_paths[:max_images]:
        if (url := image_to_data_url(p)) is not None:
            content.append({"type": "image_url", "image_url": {"url": url}})
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": content},
    ]


async def ping_with_tiny_image(cfg: dict) -> dict:
    """探活：发一张 24×24 纯色小图 + 一个问题。带图是为了当场拦下「模型不支持看图」
    这个最常见的配错（一期四类识别全部依赖视觉）。返回 {latency_ms, reply, model}。"""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (24, 24), (200, 30, 30)).save(buf, format="JPEG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    messages = [
        {"role": "user", "content": [
            {"type": "text", "text": "这张图主要是什么颜色？只回答一个词。"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]},
    ]
    t0 = time.monotonic()
    content, _usage = await chat(cfg, messages, max_tokens=32, temperature=0.0)
    return {"latency_ms": int((time.monotonic() - t0) * 1000), "reply": content[:60], "model": cfg.get("model")}


async def category_vocabulary(db: AsyncSession, asset_type: str, limit: int = 60) -> list[str]:
    """该类型下用户已有分类（去重）：附在 prompt 里让 AI 优先沿用，别发明平行体系。"""
    from app.core.models import Asset

    rows = (
        await db.execute(
            select(Asset.category)
            .where(Asset.asset_type == asset_type, Asset.deleted_at.is_(None), Asset.category.isnot(None))
            .distinct()
            .limit(limit)
        )
    ).scalars().all()
    return sorted(r for r in rows if r)
