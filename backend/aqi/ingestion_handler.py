"""Lambda handler for ingestion function."""

import json
from app import ingest_source


def handler(event, context):
    """Lambda handler for scheduled ingestion."""
    try:
        result = ingest_source()
        return {
            "statusCode": 200,
            "body": json.dumps(result)
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }