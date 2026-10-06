import argon2

_hasher = argon2.PasswordHasher()  # 默认即 argon2id


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, plain)
    except argon2.exceptions.VerificationError:
        return False
