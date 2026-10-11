"""Lambda handler for SaansSetu API using Mangum."""

from mangum import Mangum
from app import app

handler = Mangum(app, lifespan="off")