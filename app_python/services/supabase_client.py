"""
Singleton Supabase client for the Python/Flask backend.

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (preferred for headless writes;
falls back to SUPABASE_ANON_KEY if the service role key is not set).

If neither URL nor key is configured the client is None and every caller
must treat that as a no-op so the server continues to work offline.
"""

import os
from typing import Optional

_client = None
_tried = False


def get_client():
    """Return a connected supabase.Client, or None if env is unset."""
    global _client, _tried
    if _tried:
        return _client
    _tried = True

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    )

    if not url or not key:
        return None

    try:
        from supabase import create_client
        _client = create_client(url, key)
        print("[supabase] client connected")
    except Exception as e:
        print(f"[supabase] failed to connect: {e}")
        _client = None

    return _client
