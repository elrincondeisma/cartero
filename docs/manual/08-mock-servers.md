> 🌐 **English** · [Español](es/08-mock-servers.md)

# Mock servers

A mock server simulates your API by answering with the **examples** saved in your requests. Handy so the frontend can move forward before the backend exists, for demos, or for tests that must not touch production.

## Create a mock

1. Save examples in your requests: send the request and click the save icon in the response, or create them in the **Examples** tab.
2. Go to **Mock servers → New**, pick the collection and optionally an environment (to resolve `{{variables}}` in the examples) and a delay.
3. Copy the URL: `https://YOUR-CARTERO/mock/abc123`.

If an example request is `GET {{baseUrl}}/users/:id`, the mock answers `GET https://YOUR-CARTERO/mock/abc123/users/42`.

## How it picks the response

1. The **method** must match.
2. The **path** must match segment by segment. `:param` and `{{variable}}` match any value, but an exact path beats one with parameters.
3. Matching **query params** add points.
4. On a tie, 2xx responses are preferred.

You can force an example with request headers:

| Header | Effect |
|---|---|
| `x-mock-response-name: Post not found` | Uses the example with that name |
| `x-mock-response-code: 404` | Uses an example with that status code |
| `x-mock-response-id: <id>` | Uses that exact example |
| `x-mock-match-request-body: true` | Requires the body to match |
| `x-mock-match-request-headers: X-Tenant` | Requires those headers to match |

If nothing matches, it returns **404** with an explanatory message.

## Dynamic responses

In an example body you can use dynamic variables, which change on every call:

```json
{ "id": "{{$guid}}", "email": "{{$randomEmail}}", "created": "{{$isoTimestamp}}" }
```

## Private mocks and call log

- **Private**: requires an API token in the `x-api-key` header.
- **Incoming calls**: the panel shows every call, which example answered and when.
- The mock supports **CORS**, so you can call it directly from a web page.
