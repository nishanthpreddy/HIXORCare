"""Ward tablet sign-in: staff pick their name and enter a PIN; the server returns a short-lived token."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

SECRET = os.environ.get("HIXOR_SECRET", "dev-only-change-me").encode()
TOKEN_TTL = 10 * 60  # 10-minute tokens, as in the HIXOR architecture


def hash_pin(pin: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 120_000)
    return f"pbkdf2${salt.hex()}${dk.hex()}"


def check_pin(pin: str | None, stored: str) -> bool:
    if not pin:
        return False
    _, salt, digest = stored.split("$")
    return hmac.compare_digest(hash_pin(pin, bytes.fromhex(salt)).split("$")[2], digest)


def make_token(staff_id: str) -> str:
    body = base64.urlsafe_b64encode(json.dumps({"sub": staff_id, "exp": int(time.time()) + TOKEN_TTL}).encode()).decode()
    sig = hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def read_token(token: str) -> str | None:
    try:
        body, sig = token.split(".")
    except ValueError:
        return None
    if not hmac.compare_digest(sig, hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()):
        return None
    data = json.loads(base64.urlsafe_b64decode(body))
    return data["sub"] if data["exp"] > time.time() else None
