const express = require('express');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 80;

app.use(bodyParser.json());
app.use(bodyParser.text({ type: '*/*' })); // Accept raw text/other if needed

app.all('/*', (req, res) => {
    
    // Construct Event
    const event = {
        path: req.path,
        httpMethod: req.method,
        headers: req.headers,
        queryStringParameters: req.query,
        body: req.body
    };

    const context = {
        awsRequestId: 'req-' + Date.now()
    };

    const payload = JSON.stringify({ event, context });

    // Spawn Python Process
    const pythonProcess = spawn('python3', ['bridge.py']);

    let stdoutData = '';
    let stderrData = '';

    // Write payload to stdin
    pythonProcess.stdin.write(payload);
    pythonProcess.stdin.end();

    pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
        if (code !== 0) {
            console.error('Python script error:', stderrData);
            return res.status(500).json({ error: 'Internal Server Error', details: stderrData });
        }

        try {
            // Try to parse JSON response from Python
            // We assume the python script prints standard Lambda response or just JSON
            try {
                const response = JSON.parse(stdoutData.trim());
                
                if (response.statusCode) {
                    res.status(response.statusCode);
                    if (response.headers) res.set(response.headers);
                    res.send(response.body);
                } else {
                    res.json(response);
                }
            } catch (e) {
                // If not JSON, return raw
                res.send(stdoutData);
            }
            
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse execution result' });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Node-Python Bridge running on port ${PORT}`);
});
