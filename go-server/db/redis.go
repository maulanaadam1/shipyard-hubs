package db

import (
	"context"
	"log"
	"os"

	"github.com/redis/go-redis/v9"
)

var RDB *redis.Client
var Ctx = context.Background()

func InitRedis() {
	redisHost := os.Getenv("REDIS_HOST")
	if redisHost == "" {
		// Default to local/easypanel expected service name
		redisHost = "localhost:6379"
	}

	RDB = redis.NewClient(&redis.Options{
		Addr:     redisHost,
		Password: "", // no password set
		DB:       0,  // use default DB
	})

	// Check connection
	_, err := RDB.Ping(Ctx).Result()
	if err != nil {
		log.Printf("Redis Init: Failed to connect to Redis at %s, falling back to local DB cache.", redisHost)
		RDB = nil // Set to nil to indicate fallback should be used
	} else {
		log.Printf("Redis Init: Successfully connected to Redis at %s", redisHost)
	}
}
