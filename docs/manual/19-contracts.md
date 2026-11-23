> 🌐 **English** · [Español](es/19-contratos.md)

# Contracts

A contract pins down, for one request, **what the frontend sends and what the backend must return**. Both teams work against the same thing, and when someone drifts from it, Cartero tells you as soon as the request is sent.

Every contract has two parts:

- **Request**: path parameters (`:id`), query, headers and the body structure.
- **Responses**: one per status code (`200`, `404`, `422`…). Each one has its headers and the body structure. Ranges (`4XX`) and `default` work too.

You edit it in the request's **Contract** tab, next to **Examples**. Under the hood it's stored as JSON Schema (draft 2020-12, the one OpenAPI 3.1 uses).

## Creating a contract

There are two ways, and you can mix them:

- **From a real response.** Send the request, open **Contract** and click **Generate from last response**.
  - Cartero works out the types, detects formats (email, uuid, date, URL) and keeps the real values as examples.
  - The request part is filled in from the current path, query, headers and body.
  - Every generated field starts out required. Untick the ones that may be missing.
- **By hand**, before the backend exists. Click **Start from scratch** and add the fields.

To add another code, use **Response code**. If the last response came back with that same code, the **Generate from last response** button shows up inside it too.

Save the request (Ctrl+S) to save the contract.

## The field editor

Each row is a field, with:

- **Name** and **type**: text, number, integer, yes/no, object, list or null.
- **Required**: whether it may be missing.
- **Nullable**: whether it accepts `null` as well as its type.
- **More details** (the sliders icon): description, example, format and allowed values, comma-separated.

Objects and lists expand. A list has an **each item** row that describes its items.

If you'd rather write the schema, **View as JSON Schema** shows the whole contract in the code editor. Whatever you change there applies right away, as long as the JSON is valid.

## Checks on send

If the request has a contract, Cartero checks both parts every time you send it:

- Next to the status code you'll see **Matches the contract** (green) or **Contract: N failures** (red). Click the badge to see the details.
- The response's **Contract** tab splits **what was sent** from **what came back**. Every failure shows its path and the reason, for example:

| Path | Reason |
|---|---|
| `$.email` | Required, but missing |
| `$.id` | Expected integer, got string |
| `$.status` | Only these values are allowed: "active", "closed" |
| `page` | Required parameter is missing |
| `500` | This code isn't in the contract (expected: 200, 404) |

Fields that arrive but aren't in the contract show up as a **warning** (amber), not a failure. To forbid them, set `"additionalProperties": false` in the JSON Schema.

## Breaking changes

When you save, Cartero compares the new contract with the saved one. If a change would break whoever already uses it, a dialog lists the changes before saving. You can **Keep editing** or **Save anyway**.

| Breaking | Not breaking |
|---|---|
| Removing a field from the response | Adding an optional field |
| Changing a field's type | Adding a response code |
| A response field is no longer required | A request field is no longer required |
| The request asks for a new required field or parameter | The request accepts more values |
| Removing a response code | |
| A response field with limited values can return new values | |

## History

**History**, in the contract's sidebar, lists every saved version: who saved it, when and what changed, with breaking changes in red and compatible ones in green. Versions also appear in the collection's history, and you can restore them from there (see [Teams and collaboration](11-teams-and-collaboration.md)).

## Mocks from the contract

A [mock server](08-mock-servers.md) answers with your saved examples. If a request has no matching example but does have a contract, the mock builds a response that follows it:

- It uses the contract's examples and allowed values and, when there are none, sensible values based on the field's format and name.
- It answers with the contract's first 2xx code. Send the `x-mock-response-code: 404` header to ask for another one.

This way the frontend can get going with just the contract, without writing examples.

## OpenAPI

- **Export**: in the collection menu, **Export OpenAPI 3.1 (YAML)** or **(JSON)**.
  - Each request with a contract contributes its parameters, its `requestBody` and its responses.
  - Requests without a contract are described from their body and examples.
- **Import**: when you import OpenAPI 3.0/3.1 (see [Collections and import](06-collections-and-import.md)), each request gets its contract from the schemas. `$ref` and OpenAPI 3.0's `nullable` are resolved.

In the collection tree, requests with a contract show a small document icon with a tick.
