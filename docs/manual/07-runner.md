> 🌐 **English** · [Español](es/07-runner.md)

# Collection runner

Runs every request in a collection or folder, in order, with their scripts and tests. **No limits** on runs.

## Start a run

1. ··· menu of a collection or folder → **Run** (or the *Run* button in its settings).
2. Tick the requests to include (all by default).
3. Configure:
   - **Environment**.
   - **Iterations**: how many times to repeat the whole collection.
   - **Delay**: milliseconds to pause between requests.
   - **Data (CSV or JSON)**: each row is one iteration. See below.
   - **Stop on first failure**.
   - **Save variables** changed by scripts.
4. Click **Run**.

Results appear **live**: status, time, size and tests for every request. Expand a row to see the tests, the response and the request sent. Filter by *Passed* or *Failed*, check the **Console** or **Export JSON**.

## Data-driven testing

A CSV like this:

```csv
user,password,expected
ana,secret1,200
luis,wrong,401
```

runs one iteration per row. Use `{{user}}` in requests and, in tests:

```js
pm.test('Expected status', () => {
  pm.response.to.have.status(Number(pm.iterationData.get('expected')))
})
```

For JSON, use an array of objects: `[{"user":"ana"}, {"user":"luis"}]`.

## Flow control

In a script, `pm.execution.setNextRequest('Request name')` jumps to that request, and `pm.execution.setNextRequest(null)` ends the run. Useful for retries or conditional flows.

## History

Every run (from the runner, [monitors](09-monitors.md) and the [CLI](12-cli.md)) is kept in the **Runs** section.
