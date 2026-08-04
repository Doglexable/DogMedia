# DogMedia Mobile

Expo React Native client for DogMedia core user flows.

## Run

Set the Fastify API base URL before starting Expo:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3001 npm run dev --workspace=mobile
```

Common values:

- Android emulator: `http://10.0.2.2:3001`
- iOS simulator: `http://localhost:3001`
- Physical device: `http://<server-lan-ip>:3001`

Mobile cannot rely on same-origin `/api` like the Vite web app, so all media thumbnails and streams are built from `EXPO_PUBLIC_API_URL`.

## Scope

Included:

- Access guard
- Dashboard media browsing
- Categories
- Favorites
- Queue actions
- Audio/video/image player
- Synchronized lyrics
- Wrapped report and lock handling

Not included in this first mobile version:

- Admin upload/management
- Whitelist management
- Public shared favorites route
