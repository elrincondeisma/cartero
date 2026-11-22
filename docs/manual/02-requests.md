> 🌐 **English** · [Español](es/02-peticiones.md)

# Requests

## The URL bar

- **Method**: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- **URL**: supports [variables](03-variables-and-environments.md) like `{{baseUrl}}/users`. Defined variables are highlighted in orange, undefined ones in red. Hover to see their value.
- **Paste cURL**: paste a `curl …` command and the method, URL, headers, body and auth are filled in.

## Editor tabs

### Params
- **Query params**: a table kept in sync with the URL. Untick a row to stop sending it without deleting it.
- **Path variables**: if the URL has segments like `/users/:id`, a table appears to give `id` a value.

### Authorization
See [Authentication](04-authentication.md). By default each request **inherits** its folder's or collection's auth.

### Headers
Header table. Cartero adds `User-Agent`, `Accept`, `Host`, `Content-Length` and the authorization header automatically; if you add one with the same name, yours wins.

### Body
| Mode | Use |
|---|---|
| **none** | No body |
| **raw** | Free text: JSON, XML, HTML, JavaScript or text. JSON has **Beautify** |
| **form-data** | Text fields and **files** (multipart). Switch a row's type to "File" and choose one |
| **x-www-form-urlencoded** | Classic forms |
| **binary** | Send a file as-is |
| **GraphQL** | Query and variables (JSON) editors |

### Scripts
JavaScript that runs **before** sending (*Pre-request*) or **after** receiving the response (*Post-response*). See [Scripts and tests](05-scripts-and-tests.md).

### Examples
Saved responses. They document the API and are what [mock servers](08-mock-servers.md) return. To save a real one, send the request and click the save icon in the response panel.

### Description
Markdown text explaining the request. It appears in the [published documentation](10-public-docs.md).

### Settings
- Follow redirects (on by default) and keep the method on redirect.
- Verify SSL certificates (off by default, so self-signed certificates on your network work).
- Send body with GET, don't encode the URL, don't use the cookie jar.

## The response

- **Status, time and size**. Hover over the time for a breakdown (DNS, TCP, TLS, first byte, download).
- **Body**: *Pretty* (formatted and highlighted), *Raw* and *Preview* (HTML, images and PDF). Copy or download it.
- **Headers**, received **Cookies**, **Tests** (result of each `pm.test`), **Console** (`console.log` from your scripts) and **Details** (timings and the exact request that was sent, with variables substituted).

Drag the line between editor and response to resize them.

## Code

The **</>** button generates the request in 20+ languages and libraries: cURL, JavaScript (fetch, Axios), Node.js, Python (requests, http.client), Go, Java, C#, PHP, Ruby, Swift, Kotlin, Dart, PowerShell… With "Substitute variables" the active environment's values are inserted.

## History

Every request you send is kept in **History**, grouped by day. Click one to reopen it exactly as it was sent.

## Saving and unsaved changes

Tabs with unsaved changes show an orange dot. If someone else saves the same request while you're editing it, you'll see **"Someone else made changes"**: load their version or overwrite it.
