"""统一错误模型（详细设计 §4.5）：{"code", "message", "detail"}"""

from fastapi import Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int, detail: dict | None = None):
        self.code = code
        self.message = message
        self.status = status
        self.detail = detail
        super().__init__(message)


def unauthenticated(message: str = "需要登录") -> ApiError:
    return ApiError("UNAUTHENTICATED", message, 401)


def forbidden(message: str = "权限不足") -> ApiError:
    return ApiError("FORBIDDEN", message, 403)


def not_found(message: str = "资源不存在") -> ApiError:
    return ApiError("NOT_FOUND", message, 404)


def conflict(message: str, detail: dict | None = None) -> ApiError:
    return ApiError("CONFLICT", message, 409, detail)


def bad_request(message: str, detail: dict | None = None) -> ApiError:
    return ApiError("VALIDATION_ERROR", message, 422, detail)


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )
