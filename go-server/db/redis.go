package db

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/redis/go-redis/v9"
)

var RDB *redis.Client
var Ctx = context.Background()

func InitRedis() {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		host := os.Getenv("REDIS_HOST")
		if strings.HasPrefix(host, "redis://") || strings.HasPrefix(host, "rediss://") {
			redisURL = host
		}
	}

	if redisURL != "" {
		opt, err := redis.ParseURL(redisURL)
		if err == nil {
			RDB = redis.NewClient(opt)
			if _, err := RDB.Ping(Ctx).Result(); err == nil {
				log.Printf("Redis Init: Successfully connected via Redis URL")
				return
			}
		}
	}

	redisHost := os.Getenv("REDIS_HOST")
	if redisHost == "" {
		redisHost = "localhost:6379"
	}
	redisPassword := os.Getenv("REDIS_PASSWORD")

	RDB = redis.NewClient(&redis.Options{
		Addr:     redisHost,
		Password: redisPassword,
		DB:       0,
	})

	// Check connection
	_, err := RDB.Ping(Ctx).Result()
	if err != nil {
		log.Printf("Redis Init: Failed to connect to Redis at %s (%v), falling back to local DB cache.", redisHost, err)
		RDB = nil
	} else {
		log.Printf("Redis Init: Successfully connected to Redis at %s", redisHost)
	}
}
