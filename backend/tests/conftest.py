import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://hixor@127.0.0.1:5433/hixor_test")
os.environ["HIXOR_DEMO"] = "1"

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import load  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(__file__))


@pytest.fixture(scope="session", autouse=True)
def schema():
    cfg = Config(os.path.join(ROOT, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(ROOT, "migrations"))
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
def fresh_ward():
    with SessionLocal() as db:
        load(db)


@pytest.fixture
def client():
    return TestClient(app)


class Ward:
    """Signs staff in on the tablet and runs actions as them."""

    def __init__(self, client: TestClient):
        self.c = client
        self.tokens: dict[str, str] = {}

    def token(self, staff_id: str) -> str:
        if staff_id not in self.tokens:
            r = self.c.post("/api/auth/sign-in", json={"staffId": staff_id, "pin": "1234"})
            self.tokens[staff_id] = r.json()["data"]["token"]
        return self.tokens[staff_id]

    def act(self, staff_id: str, action: str, **body):
        r = self.c.post(f"/api/actions/{action}", json=body, headers={"Authorization": f"Bearer {self.token(staff_id)}"})
        return r.status_code, r.json()

    def snap(self):
        return self.c.get("/api/wards/w-2b/snapshot").json()


@pytest.fixture
def ward(client):
    return Ward(client)
