# StudioSpace

StudioSpace is a creative-studio discovery and booking platform. This repository contains the Express API used by the client application.

**Live client:** [https://studiospace-mu-sand.vercel.app](https://studiospace-mu-sand.vercel.app)

## Features

- Browse, search, filter, and sort studio listings.
- Create, update, and delete studio listings as an authenticated host.
- Book studios by date and time, with checks against overlapping confirmed bookings.
- Confirm or complete bookings as a studio host, and cancel pending bookings as a customer.
- Review studios and see their average ratings.
- Save studios to a personal wishlist.
- Authenticate API requests with Better Auth JWTs and HTTP-only cookies.

## Tech stack

- Node.js and Express 5 for the REST API.
- MongoDB for studios, users, bookings, and wishlists.
- Better Auth JWT verification using `jose` and remote or configured JWKS.
- `cors`, `cookie-parser`, and `dotenv` for API middleware and configuration.
- Vercel serverless deployment.

## Run locally

1. Install Node.js and npm, clone this repository, and install dependencies:

   ```bash
   git clone https://github.com/Jannatulakiba/StudioSpace_Server.git
   cd StudioSpace_Server
   npm install
   ```

2. Create a `.env` file in the project root:

   ```env
   PORT=5000
   MONGODB_URI=your-mongodb-connection-string
   BETTER_AUTH_URL=http://localhost:3000
   FRONTEND_URL=http://localhost:3000
   ```

   `BETTER_AUTH_URL` must match the issuer/audience configured by the client authentication service. If needed, set `BETTER_AUTH_JWKS` to a JSON Web Key Set to verify tokens with a local key set instead of fetching the remote JWKS.

3. Start the API:

   ```bash
   npm start
   ```

   The API listens on port `5000` by default. Check `http://localhost:5000/` for the server status response.

4. To run the client locally as well, configure its API URL as `http://localhost:5000` and start it using the client repository's setup instructions.

5. Run the API tests with:

   ```bash
   npm test
   ```

## Examiner test credentials

Use the demo accounts on the [live client](https://studiospace-mu-sand.vercel.app):

| Account | Email | Password |
| --- | --- | --- |
| Examiner | `examiner@studiospace.com` | `Examiner123` |
| Studio host | `tanvir@host.com` | `Host12345` |

Demo account availability depends on the live service's seeded user data.
