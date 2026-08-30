"""实时网关：对应原 NestJS 的 Socket.IO 网关。

- python-socketio AsyncServer，async_mode="asgi"，与 Django HTTP 同源同端口
  （由 backend/asgi.py 按 path 前缀分发 /socket.io/* 到本应用）
- CORS 交由 apps.common 中间件统一管控，此处 cors_allowed_origins="*"
- connect 事件校验 JWT（auth.token），并校验 tokenVersion（顶号下线）
- subscribe/unsubscribe：按 comp-{id} / user-{id} 房间订阅
- sync:replay：占位确认（与原 stub 一致）

导出 sio（AsyncServer 实例）与 application（ASGI 应用），供 asgi.py 引用。
"""
from __future__ import annotations

import logging

import socketio
from asgiref.sync import sync_to_async

logger = logging.getLogger("gipfel")

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    # 关闭 socket.io 自带的 ping 调试噪音
    ping_interval=25,
    ping_timeout=20,
)


# ==================== JWT 校验（连接握手） ====================
@sync_to_async
def _resolve_user(payload: dict):
    """根据 JWT payload 查询用户并校验 token_version。返回 user 或 None。"""
    from apps.users.models import User

    sub = payload.get("sub") if payload else None
    if not sub:
        return None
    try:
        user = User.objects.get(pk=sub)
    except User.DoesNotExist:
        return None
    except Exception:  # noqa: BLE001
        return None
    # 顶号下线：payload.tv 必须等于用户当前 token_version
    if payload.get("tv") != user.token_version:
        return None
    return user


@sio.event
async def connect(sid, environ, auth):
    """连接握手：校验 auth.token 中的 JWT，校验通过则建立会话并自动入本人房间。"""
    token = None
    if isinstance(auth, dict):
        token = auth.get("token")
    # 兼容通过 query 传递 token 的客户端
    if not token:
        qs = environ.get("QUERY_STRING", "") if environ else ""
        for pair in qs.split("&"):
            if pair.startswith("token="):
                token = pair[len("token="):]
                break

    if not token:
        logger.debug("socket.io 连接拒绝：缺少 token (sid=%s)", sid)
        return False

    from apps.auth.authentication import decode_jwt_payload

    payload = decode_jwt_payload(token)
    if payload is None:
        logger.debug("socket.io 连接拒绝：JWT 无效 (sid=%s)", sid)
        return False

    user = await _resolve_user(payload)
    if user is None:
        logger.debug("socket.io 连接拒绝：用户不存在或已顶号 (sid=%s)", sid)
        return False

    await sio.save_session(
        sid,
        {
            "user_id": user.id,
            "username": user.username,
            "role": user.role,
            "competition_id": getattr(user, "competition_id", None),
        },
    )

    # 自动加入本人房间 user-{id}
    await sio.enter_room(sid, f"user-{user.id}")
    # 自动加入所属比赛房间 comp-{id}（SUPER_ADMIN 无固定比赛，不自动入）
    cid = getattr(user, "competition_id", None)
    if cid:
        await sio.enter_room(sid, f"comp-{cid}")

    logger.info("socket.io 已连接：sid=%s user=%s", sid, user.username)
    return True


@sio.event
async def disconnect(sid):
    logger.info("socket.io 已断开：sid=%s", sid)


# ==================== 房间订阅 ====================
def _parse_room(data) -> str | None:
    if isinstance(data, dict):
        room = data.get("room")
    elif isinstance(data, str):
        room = data
    else:
        room = None
    return room if isinstance(room, str) and room else None


def _can_join(room: str, session: dict) -> bool:
    """校验当前用户是否有权订阅该房间。"""
    if room.startswith("user-"):
        try:
            uid = int(room[len("user-"):])
        except ValueError:
            return False
        return uid == session.get("user_id")
    if room.startswith("comp-"):
        try:
            cid = int(room[len("comp-"):])
        except ValueError:
            return False
        # SUPER_ADMIN 可订阅任意比赛房间；其余只能订阅所属比赛
        if session.get("role") == "SUPER_ADMIN":
            return True
        return cid == session.get("competition_id")
    return False


@sio.on("subscribe")
async def on_subscribe(sid, data):
    session = await sio.get_session(sid)
    room = _parse_room(data)
    if not room:
        return {"ok": False, "message": "缺少 room 参数"}
    if not _can_join(room, session):
        return {"ok": False, "message": "无权订阅该房间"}
    await sio.enter_room(sid, room)
    logger.debug("socket.io 订阅：sid=%s room=%s", sid, room)
    return {"ok": True, "room": room}


@sio.on("unsubscribe")
async def on_unsubscribe(sid, data):
    room = _parse_room(data)
    if not room:
        return {"ok": False, "message": "缺少 room 参数"}
    await sio.leave_room(sid, room)
    logger.debug("socket.io 取消订阅：sid=%s room=%s", sid, room)
    return {"ok": True, "room": room}


# ==================== 同步重放（占位） ====================
@sio.on("sync:replay")
async def on_sync_replay(sid, data):
    """占位实现：仅确认收到，后续由各业务模块填充重放逻辑。"""
    return {"ok": True, "message": "replay-ack", "received": bool(data)}


# ==================== ASGI 应用 ====================
application = socketio.ASGIApp(sio)
