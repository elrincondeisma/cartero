> 🌐 [English](../07-runner.md) · **Español**

# Runner de colecciones

Ejecuta todas las peticiones de una colección o carpeta, en orden, con sus scripts y tests. **Sin límites** de ejecuciones.

## Lanzar una ejecución

1. Menú ··· de una colección o carpeta → **Ejecutar** (o el botón *Ejecutar* de su configuración).
2. Marca las peticiones que quieres incluir (por defecto, todas).
3. Configura:
   - **Entorno**.
   - **Iteraciones**: cuántas veces repetir la colección completa.
   - **Retardo**: milisegundos de pausa entre peticiones.
   - **Datos (CSV o JSON)**: cada fila es una iteración. Ver abajo.
   - **Parar al primer fallo**.
   - **Guardar las variables** que cambien los scripts.
4. Pulsa **Ejecutar**.

Los resultados aparecen **en vivo**: estado, tiempo, tamaño y tests de cada petición. Despliega una fila para ver los tests, la respuesta y la petición enviada. Filtra por *Correctas* o *Con fallos*, revisa la **Consola** o **Exporta el JSON**.

## Pruebas con datos (data-driven)

Un CSV como este:

```csv
usuario,password,esperado
ana,secreto1,200
luis,mal,401
```

lanza una iteración por fila. En las peticiones usa `{{usuario}}` y, en los tests:

```js
pm.test('Código esperado', () => {
  pm.response.to.have.status(Number(pm.iterationData.get('esperado')))
})
```

Con JSON, usa un array de objetos: `[{"usuario":"ana"}, {"usuario":"luis"}]`.

## Control de flujo

En un script, `pm.execution.setNextRequest('Nombre de la petición')` salta a esa petición, y `pm.execution.setNextRequest(null)` termina la ejecución. Sirve para reintentos o flujos condicionales.

## Historial

Todas las ejecuciones (del runner, de los [monitores](09-monitores.md) y de la [CLI](12-cli.md)) quedan en la sección **Ejecuciones**.
