from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any


PASSWORD_HASH = (
    "$argon2id$v=19$m=65536,t=2,p=1$razZBR8PFZthEq6Ht0wtaW27hp5rSd55My53nIkWS0w$"
    "wA+/ydmI6D86x6eUpBAxEULggS9N558+LCZCHBhUjXA"
)


def _days_ago(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat().replace("+00:00", "Z")


def create_seed_state() -> dict[str, Any]:
    return {
        "users": [
            {
                "id": "USR-CUSTOMER-1",
                "name": "Aarav Customer",
                "email": "customer1@s30.test",
                "passwordHash": PASSWORD_HASH,
                "role": "CUSTOMER",
            },
            {
                "id": "USR-CUSTOMER-2",
                "name": "Mira Customer",
                "email": "customer2@s30.test",
                "passwordHash": PASSWORD_HASH,
                "role": "CUSTOMER",
            },
            {
                "id": "USR-SUPPORT-1",
                "name": "S30 Support",
                "email": "support@s30.test",
                "passwordHash": PASSWORD_HASH,
                "role": "SUPPORT",
            },
        ],
        "products": [
            {"id": "PROD-KEYBOARD", "name": "Mechanical Keyboard", "price": 1500},
            {"id": "PROD-HEADPHONES", "name": "Wireless Headphones", "price": 4999},
            {"id": "PROD-MOUSE", "name": "Wireless Mouse", "price": 999},
        ],
        "inventory": [
            {"productId": "PROD-KEYBOARD", "stock": 10},
            {"productId": "PROD-HEADPHONES", "stock": 5},
            {"productId": "PROD-MOUSE", "stock": 0},
        ],
        "orders": [
            {
                "id": "ORD-1001",
                "customerId": "USR-CUSTOMER-1",
                "productId": "PROD-KEYBOARD",
                "status": "DELIVERED",
                "deliveredAt": _days_ago(3),
            },
            {
                "id": "ORD-1002",
                "customerId": "USR-CUSTOMER-1",
                "productId": "PROD-HEADPHONES",
                "status": "DELIVERED",
                "deliveredAt": _days_ago(5),
            },
            {
                "id": "ORD-1003",
                "customerId": "USR-CUSTOMER-2",
                "productId": "PROD-MOUSE",
                "status": "DELIVERED",
                "deliveredAt": _days_ago(2),
            },
            {
                "id": "ORD-OLD-1",
                "customerId": "USR-CUSTOMER-1",
                "productId": "PROD-KEYBOARD",
                "status": "DELIVERED",
                "deliveredAt": _days_ago(45),
            },
            {
                "id": "ORD-SHIPPED-1",
                "customerId": "USR-CUSTOMER-1",
                "productId": "PROD-KEYBOARD",
                "status": "SHIPPED",
                "deliveredAt": None,
            },
        ],
        "policies": [
            {
                "id": "POL-REPLACEMENT",
                "title": "Damaged item replacement",
                "content": (
                    "Damaged delivered items can be replaced within 7 days when stock exists."
                ),
            },
            {
                "id": "POL-REFUND",
                "title": "Refunds",
                "content": (
                    "Delivered orders can be refunded within 30 days. "
                    "Refunds above ₹2,000 require support approval."
                ),
            },
            {
                "id": "POL-DUPLICATE",
                "title": "Duplicate actions",
                "content": "An order may receive only one refund or replacement.",
            },
        ],
        "tickets": [],
        "messages": [],
        "agentRuns": [],
        "toolCalls": [],
        "actions": [],
        "approvals": [],
        "activeRuns": set(),
    }


# Keep this dictionary reference stable. Access collections through state["tickets"], etc.
state: dict[str, Any] = create_seed_state()


def reset_state() -> bool:
    if state["activeRuns"]:
        return False

    fresh = deepcopy(create_seed_state())
    state.clear()
    state.update(fresh)
    return True
