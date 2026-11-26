# City Guide Admin Dashboard - Developer Guide

## Overview

This repository contains a small, static, single-page admin dashboard. It is a browser-only client for the City Guide backend; it does not contain backend services, a database, a build system, or a package manager.

The dashboard's entry point is [index.html](./index.html). It loads [app.js](./app.js) for authentication and API interactions and [styles.css](./styles.css) for the dashboard and sign-in presentation. The repository currently has no `package.json`, automated test suite, or environment-variable configuration.

## Run locally

Serve the `docs` directory over HTTP so that browser `fetch`, `localStorage`, and the backend's cross-origin policy work as expected. For example, with Python installed:

```powershell
python -m http.server 8000 --directory docs
```

Then open `http://localhost:8000/`. Do not open the page as a `file://` URL: browser security rules can prevent its API requests from working.

Sign in with an administrator account provisioned by the backend. The dashboard uses the production API at `https://app-citi-guide-backend.onrender.com`; it does not provide demo credentials or create admin accounts.

## Repository layout

| File | Responsibility |
| --- | --- |
| [index.html](./index.html) | Single-page markup: sign-in, dashboard sections, navigation, dialogs, filters, and form controls. |
| [app.js](./app.js) | Session state, authentication, API requests, rendering, form submissions, and event handlers. |
| [styles.css](./styles.css) | Shared dashboard styles, responsive layout and interactions, and the animated sign-in appearance. |

There are no separate HTML pages for login and dashboard. Authentication switches between the sign-in section and the dashboard shell in the same document.

## Application structure and lifecycle

1. The HTML loads `app.js` with `defer`, so the DOM is parsed before the script initializes event handlers.
2. `initialize()` attaches handlers and checks the stored access token, refresh token, and user role. If there is no valid-looking admin session, it clears stored session data and displays the sign-in form.
3. After successful authentication, the app verifies `user.role === "ADMIN"`, stores the tokens and user, shows the dashboard, and loads cities and the first page of places.
4. Navigation toggles the dashboard, places, and cities sections. Reviews are opened from a place row and are scoped to that place.
5. City and place forms use native `<dialog>` elements for create and edit. The overview counts use data returned by the cities and places endpoints; they are not analytics from a dedicated statistics API.

Most dynamic values are escaped with `escapeHtml()` before being inserted into HTML. Use the existing helper when rendering backend-provided text or IDs.

## Authentication and API requests

`API_BASE` in `app.js` is the production backend URL. The `api()` helper adds the bearer access token to requests, serializes JSON request bodies, parses responses, and reports backend `message` values on errors. For `FormData`, it intentionally leaves the `Content-Type` header unset so the browser can add the multipart boundary.

When a protected request returns `401`, the client attempts one refresh using `POST /api/auth/refresh`, then retries the original request once. If refresh does not succeed, the session is cleared and the sign-in form is shown. Login and logout use the shared `/api/auth/login` and `/api/auth/logout` endpoints; there is no `/api/admin/login` endpoint.

Session values are stored in browser `localStorage` under:

| Key | Value |
| --- | --- |
| `cityguide_access_token` | JWT access token |
| `cityguide_refresh_token` | Refresh token |
| `cityguide_admin_user` | Serialized user returned by login |

Because tokens are stored in `localStorage`, only run this dashboard in a trusted browser environment and keep the page free of unsafe script injection. The backend remains responsible for authorization; the client-side role check is a UI/session guard, not an authorization boundary.

## Connected backend features

All protected operations use the bearer token through `api()`.

| Dashboard feature | Backend request |
| --- | --- |
| Admin sign-in | `POST /api/auth/login`; the client requires an `ADMIN` user and both tokens. |
| Restore / refresh session | `POST /api/auth/refresh` |
| Sign out | `POST /api/auth/logout` |
| List cities | `GET /api/cities` |
| Create, edit, delete city | `POST /api/admin/cities`, `PUT /api/admin/cities/{id}`, `DELETE /api/admin/cities/{id}` |
| Search and list places | `GET /api/places` with `q`, `city`, `category`, `minRating`, `sort`, `page`, and `size` as applicable |
| Read one place for editing | `GET /api/places/{id}` |
| Create, edit, delete place | `POST /api/admin/places`, `PUT /api/admin/places/{id}`, `DELETE /api/admin/places/{id}` |
| Upload / delete place image | `POST /api/admin/places/{id}/images` using multipart form data; `DELETE /api/admin/places/{id}/images/{imageId}` |
| List reviews for a place | `GET /api/places/{id}/reviews` |
| Delete a review | `DELETE /api/admin/reviews/{id}` |

The places table requests 20 items per page. The API starts page numbering at zero and limits page size to 100. Place search is debounced from the sidebar; the places filter form also supports city, category, minimum rating, and sort.

City and place mutations send the documented API fields. IDs are URL-encoded when used in paths. Place IDs are generated from the name if left blank; an edited place keeps its existing ID. Image uploads are sent one at a time and the file input enforces a 5 MB per-file limit. Existing images can only be deleted when the place response includes an image ID; image URLs come from the API response and are not constructed by the client.

## API limitations represented in the UI

The backend reference does not provide a global reviews list, global review count, user-management endpoints, or dashboard-statistics endpoint. The UI therefore only displays reviews for a selected place and does not claim to manage users or show unsupported analytics. City deletion can fail when places still reference that city; the backend response is surfaced to the user.

## UI and styling notes

The sign-in screen is styled inside `#authScreen` and borrows the standalone login design: an animated gradient mesh, translucent glass container, green overlay, and responsive form layout. Keep sign-in selectors scoped to `#authScreen` so they do not affect dashboard dialogs and forms.

The dashboard stylesheet also defines shared color tokens, dark-mode behavior, the responsive sidebar, bento cards, glass surfaces, dialogs, and mobile layouts. Its transitions and keyframe animations are part of the existing visual design; avoid broad selector or animation changes when modifying a single component.

## Change and verification guidance

- Keep the dashboard single-page; do not introduce a second login redirect.
- Use only endpoint paths and request fields supported by the backend reference. Do not treat client-side visibility as backend authorization.
- Keep API access in the existing helper so token and error handling stay consistent.
- Preserve the current HTML IDs consumed by `app.js`, or update both sides together.
- Use the backend-returned IDs for edits and deletes, and escape API data before placing it into `innerHTML`.
- Check the browser console and network panel after UI/API changes. Exercise login, refresh, sign-out, empty results, API failures, and the relevant CRUD flow.

There is currently no repository-defined build, lint, or test command. A documentation-only change can be reviewed directly; for code changes, serve the page locally and verify the affected browser flow against the backend.
