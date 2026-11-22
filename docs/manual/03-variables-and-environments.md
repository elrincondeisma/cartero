> 🌐 **English** · [Español](es/03-variables-y-entornos.md)

# Variables and environments

Variables avoid repeating values (base URLs, tokens, IDs) and let you switch environments without touching your requests. Write them in double curly braces: `{{baseUrl}}`.

## Scopes and precedence

From lowest to highest priority (if two share a name, the lower one in this list wins):

1. **Globals**: for the whole workspace. Environments → Globals.
2. **Collection**: in the collection's settings → Variables.
3. **Folder**: in the folder's settings → Variables.
4. **Environment**: the active environment's.
5. **Data**: the CSV/JSON file columns in the [runner](07-runner.md).
6. **Local**: created by a script with `pm.variables.set()`, lasting only for that run.

## Environments

An environment is a named set of variables: *Local*, *Staging*, *Production*…

- Create one in **Environments → +**.
- Activate it from the top bar selector, the ✓ in the list or Ctrl+K.
- The 👁 icon next to the selector shows the active variables without leaving what you're doing.

## Secret variables

Mark a variable as **Secret** to:
- hide its value on screen (unless you enable "Show secrets");
- store it **encrypted** in the database (AES-256-GCM);
- never include it in published documentation or show it to AI assistants.

## Variables from scripts

```js
pm.environment.set('token', pm.response.json().token)  // saved to the environment
pm.collectionVariables.set('userId', 42)               // saved to the collection
pm.globals.set('lastRun', Date.now())                  // saved to globals
pm.variables.set('temp', 'x')                          // only during this run
```

Changes scripts make to environments, collection and globals are **saved automatically** (if you have edit rights), just like in Postman.

## Dynamic variables

They generate a new value on every send: `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`, `{{$randomFirstName}}`, `{{$randomFullName}}`, `{{$randomCity}}`, `{{$randomCompanyName}}`, `{{$randomLoremSentence}}`, `{{$randomUUID}}`, `{{$randomBoolean}}`, `{{$randomPrice}}`… (the same as Postman).
