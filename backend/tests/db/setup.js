process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL
process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-do-not-use-in-prod'
process.env.CLOUDINARY_CLOUD_NAME = 'test_cloud'
