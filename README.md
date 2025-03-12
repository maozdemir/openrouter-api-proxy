# OpenRouter.ai API Proxy

A secure proxy server for OpenRouter.ai that handles API key rotation, rate limiting, and connection security.

## Features

- Automatically rotates between multiple API keys
- Blacklists rate-limited keys until their reset time
- Only accepts connections from localhost
- Only forwards requests starting with `/api/`
- Drops all non-API and non-localhost connections
- Handles SSL/TLS certificates automatically
- Comprehensive request/response logging

## Installation

1. Clone the repository:

```bash
git clone https://github.com/maozdemir/openrouter-api-proxy.git
cd openrouter-api-proxy
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment:
   - Copy `.env.example` to `.env`:

     ```bash
     cp .env.example .env
     ```

   - Edit `.env` with your settings:

     ```ini
     # Server Configuration
     PORT=3000

     # Logging Configuration
     LOG_LEVEL=info
     LOG_FORMAT=json
     LOG_FILE=logs/proxy.log

     # Whether to log full request/response bodies
     LOG_BODIES=false
     ```

4. Configure API keys:
   - Create `config/api-keys.txt` with your API keys (one per line):

     ```
     sk-or-key1...
     sk-or-key2...
     sk-or-key3...
     ```

## Usage

1. Start the proxy server:

```bash
npm start
```

2. Make API requests to `http://localhost:3000/api/*`
   - All requests must come from localhost
   - All requests must start with `/api/`
   - All other connections will be dropped

Example:

```bash
curl http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-pro",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Security

- Only accepts connections from localhost (127.0.0.1, ::1, ::ffff:127.0.0.1)
- Drops all non-API requests immediately
- Automatically rotates API keys
- Blacklists rate-limited keys
- SSL/TLS certificate handling
- No WebSocket support (API requests only)

## Logging

Logs are stored in `logs/proxy-YYYY-MM-DD.log` and include:

- All incoming requests with headers (sanitized)
- Response status codes and headers
- Request/response bodies (if LOG_BODIES=true)
- API key usage (redacted)
- Rate limit events and remaining quota
- Error messages

### Log Format

```json
{
  "timestamp": "2025-03-12T02:40:33.125+03:00",
  "level": "info",
  "type": "request",
  "method": "POST",
  "url": "/api/v1/chat/completions",
  "headers": {
    "authorization": "Bearer sk-or-..."
  }
}
```

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `LOG_LEVEL`: Logging level (info/debug/error)
- `LOG_FORMAT`: Log format (json)
- `LOG_FILE`: Log file path pattern
- `LOG_BODIES`: Whether to log request/response bodies
- `NODE_ENV`: Environment (development/production)

### API Keys

Add your OpenRouter.ai API keys to `config/api-keys.txt`, one per line. The proxy will automatically:

- Load keys on startup
- Watch for file changes
- Rotate between available keys
- Blacklist rate-limited keys until their reset time

## Error Handling

- Rate limit detection (both header and response body)
- Automatic retry with different API key when rate limited
- Comprehensive error logging
- Global error handlers for uncaught exceptions

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Issues

If you find any bugs or have feature requests, please [open an issue](https://github.com/maozdemir/openrouter-api-proxy/issues).

## License

MIT License

## Author

[maozdemir](https://github.com/maozdemir)
