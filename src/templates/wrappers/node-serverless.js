const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 80;

app.use(bodyParser.json());

// Importar la función del usuario
// Asumimos que el archivo del usuario está en el mismo directorio
const userModule = require('./{{FILENAME}}');
const userHandler = userModule['{{HANDLER_NAME}}'];

if (typeof userHandler !== 'function') {
    console.error('Error: El handler "{{HANDLER_NAME}}" no es una función en "{{FILENAME}}".');
    process.exit(1);
}

app.all('/*', async (req, res) => {
    console.log('Solicitud recibida:', req.method, req.path);

    // Simular objeto de evento (simplificado)
    const event = {
        path: req.path,
        httpMethod: req.method,
        headers: req.headers,
        queryStringParameters: req.query,
        body: req.body,
        isBase64Encoded: false
    };

    // Simular contexto (simplificado)
    const context = {
        succeed: (result) => {
            res.status(200).json(result);
        },
        fail: (error) => {
            res.status(500).json({ error: error.toString() });
        },
        done: (err, res) => err ? context.fail(err) : context.succeed(res)
    };

    try {
        // Ejecutar handler. Soportamos handlers async y callback-style
        const result = userHandler(event, context, (err, response) => {
             if (err) return context.fail(err);
             
             // Si la respuesta tiene formato { statusCode, body ... } (tipo AWS proxy)
             if (response && response.statusCode) {
                 res.status(response.statusCode);
                 if (response.headers) res.set(response.headers);
                 res.send(response.body);
             } else {
                 context.succeed(response);
             }
        });

        // Si devuelve promesa
        if (result && typeof result.then === 'function') {
            const response = await result;
            if (response && response.statusCode) {
                 res.status(response.statusCode);
                 if (response.headers) res.set(response.headers);
                 res.send(response.body);
            } else {
                 res.status(200).json(response);
            }
        }
    } catch (error) {
        console.error('Error ejecutando handler:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.listen(port, () => {
    if(port == 80) {
        console.log(`Starts Serverless`);
    } else {
        console.log(`Starts Serverless on port ${port}`);
    }
});
