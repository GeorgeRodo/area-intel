import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db.models import Base

# Load environment variables from .env and web/.env.local
load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / "web" / ".env.local")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///data/intel.db")

engine = create_engine(DATABASE_URL, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


def init_db():
    os.makedirs("data", exist_ok=True)
    Base.metadata.create_all(engine)


if __name__ == "__main__":
    init_db()
    print(f"Initialized {DATABASE_URL}")
