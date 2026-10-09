"""M0 内核表（详细设计 §2.1/§2.2/§2.3 jobs、§4.3）。领域扩展表随 M1–M5 里程碑加入。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    ARRAY, BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, SmallInteger, String,
    Text, text, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    username: Mapped[str] = mapped_column(Text, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, default="member")  # admin | member
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SessionToken(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # secrets.token_urlsafe(32)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    asset_type: Mapped[str] = mapped_column(Text)  # font|music|video|book|image
    status: Mapped[str] = mapped_column(Text, default="pending")  # pending|parsing|ready|failed
    title: Mapped[str] = mapped_column(Text, default="")
    storage_key: Mapped[str] = mapped_column(Text, unique=True)  # "{root_alias}:{relative_path}"
    file_name: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    file_mtime: Mapped[int] = mapped_column(BigInteger, default=0)
    mime_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    fingerprint: Mapped[str] = mapped_column(Text, default="", index=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    rating: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_assets_list", "asset_type", "deleted_at", "created_at"),
        Index("idx_assets_status", "status"),
    )


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), nullable=True)


class AssetTag(Base):
    __tablename__ = "asset_tags"

    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# M6 打磨：打包下载 / 分享链接 / 智能集合（详细设计 §8/§13）
class DownloadPack(Base):
    __tablename__ = "download_packs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(Text, default="queued")  # queued|running|done|failed
    params: Mapped[dict] = mapped_column(JSONB, default=dict)    # {"asset_ids":[...]} 或 {"type":"image","favorite":true}
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    file_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShareLink(Base):
    __tablename__ = "share_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    token: Mapped[str] = mapped_column(Text, unique=True)  # secrets.token_urlsafe
    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"))
    allow_download: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedCollection(Base):
    __tablename__ = "saved_collections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(Text)
    asset_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    params: Mapped[dict] = mapped_column(JSONB, default=dict)  # {"q": "...", "favorite": true}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# 领域扩展表 M5：视频（详细设计 §2.3/§5.3）
class VideoSeries(Base):
    __tablename__ = "video_series"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text, unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    cover_path: Mapped[str | None] = mapped_column(Text, nullable=True)  # 取首集封面帧


class VideoDetail(Base):
    __tablename__ = "video_details"

    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(Text, default="clip")  # clip | tutorial
    series_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("video_series.id", ondelete="SET NULL"), nullable=True)
    episode: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    container: Mapped[str | None] = mapped_column(Text, nullable=True)
    video_codec: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_codec: Mapped[str | None] = mapped_column(Text, nullable=True)
    streamable: Mapped[bool] = mapped_column(Boolean, default=False)
    cover_path: Mapped[str | None] = mapped_column(Text, nullable=True)  # 选定封面帧（cover_1..3 之一）


# 领域扩展表 M4：音乐三级聚合（详细设计 §2.3/§5.2）
class MusicArtist(Base):
    __tablename__ = "music_artists"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text, unique=True)


class MusicAlbum(Base):
    __tablename__ = "music_albums"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    artist_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("music_artists.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(Text)
    year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    cover_path: Mapped[str | None] = mapped_column(Text, nullable=True)  # 派生物路径（首曲封面）
    __table_args__ = (Index("uq_album_artist_name", "artist_id", "name", unique=True),)


class MusicTrack(Base):
    __tablename__ = "music_tracks"

    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    album_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("music_albums.id", ondelete="SET NULL"), nullable=True)
    artist_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("music_artists.id", ondelete="SET NULL"), nullable=True)
    track_no: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    disc_no: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    format: Mapped[str | None] = mapped_column(Text, nullable=True)
    bitrate_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sample_rate_hz: Mapped[int | None] = mapped_column(Integer, nullable=True)
    has_lyrics: Mapped[bool] = mapped_column(Boolean, default=False)
    streamable: Mapped[bool] = mapped_column(Boolean, default=True)


# 领域扩展表 M3：书籍（详细设计 §2.3/§5.4）
class BookDetail(Base):
    __tablename__ = "book_details"

    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    authors: Mapped[list] = mapped_column(ARRAY(Text), default=list)
    publisher: Mapped[str | None] = mapped_column(Text, nullable=True)
    pub_year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    isbn: Mapped[str | None] = mapped_column(Text, nullable=True)
    series_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    series_index: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    format: Mapped[str | None] = mapped_column(Text, nullable=True)  # epub|pdf|mobi|azw3|txt
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)


# 阅读进度（详细设计 §2.3/§6.3）：视频观看与书籍阅读共用
class UserProgress(Base):
    __tablename__ = "user_progress"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[dict] = mapped_column(JSONB, default=dict)  # 书 {cfi,pct} / 视频 {seconds}
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# 领域扩展表 M2：字体（详细设计 §2.3/§5.1）
class FontDetail(Base):
    __tablename__ = "font_details"

    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    family: Mapped[str] = mapped_column(Text, default="", index=True)   # 聚合键：nameID16 优先，回落 nameID1
    style: Mapped[str | None] = mapped_column(Text, nullable=True)
    weight: Mapped[int] = mapped_column(SmallInteger, default=400)      # OS/2 usWeightClass
    italic: Mapped[bool] = mapped_column(Boolean, default=False)
    is_variable: Mapped[bool] = mapped_column(Boolean, default=False)
    formats: Mapped[list] = mapped_column(ARRAY(Text), default=list)
    glyph_count: Mapped[int] = mapped_column(Integer, default=0)
    languages: Mapped[list] = mapped_column(ARRAY(Text), default=list)
    license: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[str | None] = mapped_column(Text, nullable=True)
    designer: Mapped[str | None] = mapped_column(Text, nullable=True)


# 领域扩展表 M1：图片（详细设计 §2.3/§5.5）
class ImageDetail(Base):
    __tablename__ = "image_details"

    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    camera_make: Mapped[str | None] = mapped_column(Text, nullable=True)
    camera_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    lens: Mapped[str | None] = mapped_column(Text, nullable=True)
    iso: Mapped[int | None] = mapped_column(Integer, nullable=True)
    aperture: Mapped[float | None] = mapped_column(Float, nullable=True)
    shutter: Mapped[str | None] = mapped_column(Text, nullable=True)
    focal_length_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_long: Mapped[float | None] = mapped_column(Float, nullable=True)
    orientation: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ImageAlbum(Base):
    __tablename__ = "image_albums"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, default="directory")  # directory | manual
    dir_path: Mapped[str | None] = mapped_column(Text, nullable=True)


class ImageAlbumItem(Base):
    __tablename__ = "image_album_items"

    album_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("image_albums.id", ondelete="CASCADE"), primary_key=True)
    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(Text, default="queued")  # queued|running|done|failed
    priority: Mapped[int] = mapped_column(SmallInteger, default=5)  # 小=优先
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    worker_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # 本次执行开始时间（区别于排队等待）
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("idx_jobs_claim", "status", "priority", "run_at"),)
