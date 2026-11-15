from channels_redis.core import RedisChannelLayer

from config.settings import redis_channel_layer


def test_channel_layer_read_timeout_outlives_its_blocking_wait():
    """Regression: redis-py 8's default 5 s read timeout equalled channels_redis's 5 s blocking
    wait, so every idle socket died after ~5 s (random chat never matched)."""
    cfg = redis_channel_layer("redis://redis:6379/0")
    host = cfg["CONFIG"]["hosts"][0]
    assert host["socket_timeout"] >= RedisChannelLayer.brpop_timeout * 3

    # And channels_redis really builds its pool with that timeout.
    layer = RedisChannelLayer(**cfg["CONFIG"])
    pool = layer.create_pool(0)
    assert pool.connection_kwargs["socket_timeout"] == host["socket_timeout"]
