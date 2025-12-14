const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 80;

// Importar la función del usuario
// Asumimos que el archivo del usuario está en el mismo directorio
const userModule = require('./{{FILENAME}}');
const userHandler = userModule['{{HANDLER_NAME}}'];

if (typeof userHandler !== 'function') {
    console.error('Error: El handler "{{HANDLER_NAME}}" no es una función en "{{FILENAME}}".');
    process.exit(1);
}

const server = http.createServer(async (req, res) => {
    console.log('Solicitud recibida:', req.method, req.url);

    // Parse Body manually
    let body = [];
    req.on('data', (chunk) => {
        body.push(chunk);
    }).on('end', async () => {
        body = Buffer.concat(body).toString();
        
        // Try parsing JSON if content-type is json
        let parsedBody = body;
        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            try {
                parsedBody = JSON.parse(body);
            } catch (e) {
                // Keep as string if parse fails
            }
        }

        const parsedUrl = url.parse(req.url, true);

        // Simular objeto de evento (simplificado)
        // AWS Lambda entrega body como string. serverless-http lo necesita así.
        const event = {
            path: parsedUrl.pathname,
            httpMethod: req.method,
            headers: req.headers,
            queryStringParameters: parsedUrl.query,
            body: body, // RAW STRING body
            isBase64Encoded: false,
            // rawBody: body  // Algunos frameworks usan esto
        };

        // Simular contexto
        const context = {
            succeed: (result) => {
                sendResponse(res, 200, result);
            },
            fail: (error) => {
                sendResponse(res, 500, { error: error.toString() });
            },
            done: (err, result) => err ? context.fail(err) : context.succeed(result),
            awsRequestId: 'req-' + Date.now()
        };

        try {
            // Ejecutar handler
            const result = userHandler(event, context, (err, response) => {
                 if (err) return context.fail(err);
                 handleResult(res, response, context);
            });

            // Si devuelve promesa
            if (result && typeof result.then === 'function') {
                try {
                    const response = await result;
                    handleResult(res, response, context);
                } catch (e) {
                    context.fail(e);
                }
            }
        } catch (error) {
            console.error('Error ejecutando handler:', error);
            context.fail(error);
        }
    });
});

function handleResult(res, response, context) {
    // Si la respuesta tiene formato { statusCode, body ... } (tipo AWS proxy)
    if (response && response.statusCode) {
        // Headers
        if (response.headers) {
            for (const key in response.headers) {
                res.setHeader(key, response.headers[key]);
            }
        }
        
        res.writeHead(response.statusCode);
        
        let bodyToSend = response.body;
        if (typeof bodyToSend !== 'string' && !Buffer.isBuffer(bodyToSend)) {
             bodyToSend = JSON.stringify(bodyToSend);
        }
        res.end(bodyToSend);
    } else {
        // Respuesta simple directa
        sendResponse(res, 200, response);
    }
}

function sendResponse(res, statusCode, data) {
    if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(statusCode);
    }
    res.end(JSON.stringify(data));
}

server.listen(PORT, () => {
    if(PORT == 80) {
        console.log(`Starts Serverless Native Wrapper`);
    } else {
        console.log(`Starts Serverless Native Wrapper on port ${PORT}`);
    }
});
