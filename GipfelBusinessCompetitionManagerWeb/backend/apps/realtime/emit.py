"""实时广播辅助：对应原 NestJS RealtimeService.emitResourceChanged。

Django HTTP 视图为同步代码，而 socket.io AsyncServer 在事件循环中运行；
通过 sio.emit 在有运行中事件循环时可直接调用（python-socketio 内部转 async）。
若无事件循环（如脚本/测试），降级为静默跳过，不阻断主流程。

广播事件名 "resource:changed"，payload:
    { resource, id, competitionId, action }
其中 action ∈ created / updated / deleted。
"""
from __future__ import annotations

import logging

logger = logging.getLogger("gipfel")

EVENT_RESOURCE_CHANGED = "resource:changed"


def emit_resource_changed(
    resource: str,
    record_id: int,
    competition_id: int | None,
    action: str,
) -> None:
    """向相关比赛/用户房间广播资源变更事件。"""
    payload = {
        "resource": resource,
        "id": record_id,
        "competitionId": competition_id,
        "action": action,
    }
    try:
        from .gateway import sio

        # 广播到比赛房间；super-admin 跨比赛订阅需客户端自行 subscribe
        if competition_id is not None:
            sio.emit(EVENT_RESOURCE_CHANGED, payload, room=f"comp-{competition_id}")
        else:
            # 全局资源（如产业类型模板）广播到所有连接
            sio.emit(EVENT_RESOURCE_CHANGED, payload)
    except Exception:  # noqa: BLE001 - 实时失败不阻断业务
        logger.debug("实时广播失败 resource=%s id=%s", resource, record_id, exc_info=True)


def emit_to_users(user_ids, event: str, data) -> None:
    """向一组用户的私有房间（user-{id}）推送事件。对应原 NestJS RealtimeService.emitToUsers。

    data 必须为 JSON 可序列化结构（datetime 等需调用方自行 ISO 化）。
    """
    try:
        from .gateway import sio

        for uid in user_ids:
            sio.emit(event, data, room=f"user-{uid}")
    except Exception:  # noqa: BLE001 - 实时失败不阻断业务
        logger.debug("实时推送失败 event=%s", event, exc_info=True)


def emit_resource_changed_to_users(
    resource: str,
    record_id: int,
    user_ids,
    action: str,
    competition_id: int | None = None,
) -> None:
    """向指定用户房间广播资源变更事件（收件人维度，如消息中心新消息 / 删除）。"""
    payload = {
        "resource": resource,
        "id": record_id,
        "competitionId": competition_id,
        "action": action,
    }
    emit_to_users(user_ids, EVENT_RESOURCE_CHANGED, payload)
