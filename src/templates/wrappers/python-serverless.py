import os
import sys
import json
import importlib.util
from flask import Flask, request, jsonify

app = Flask(__name__)
PORT = int(os.environ.get('PORT', 80))

# Import logic
HANDLER_FILE = '{{FILENAME}}'
HANDLER_NAME = '{{HANDLER_NAME}}'

# Add current directory to sys.path
sys.path.append(os.getcwd())

user_handler = None
try:
    module = importlib.import_module(HANDLER_FILE)
    user_handler = getattr(module, HANDLER_NAME)
except Exception as e:
    print(f"Error importing handler {HANDLER_FILE}.{HANDLER_NAME}: {e}")
    # Don't exit yet, fail on request
    
class Context:
    def __init__(self):
        self.function_name = HANDLER_NAME
        self.memory_limit_in_mb = 128
        self.aws_request_id = 'mock-request-id'
        self.invoked_function_arn = 'arn:aws:lambda:local:000000000000:function:mock'

    def get_remaining_time_in_millis(self):
        return 3000

@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
def catch_all(path):
    global user_handler
    if not user_handler:
        return jsonify({"message": f"Handler {HANDLER_NAME} not found in {HANDLER_FILE}"}), 500

    # Construct event object (AWS Proxy Integration style)
    event = {
        "resource": "/",
        "path": request.path,
        "httpMethod": request.method,
        "headers": dict(request.headers),
        "queryStringParameters": request.args.to_dict(),
        "pathParameters": None, 
        "stageVariables": None,
        "requestContext": {
            "http": {
                "method": request.method,
                "path": request.path
            }
        },
        "body": request.get_data(as_text=True),
        "isBase64Encoded": False
    }

    context = Context()

    try:
        response = user_handler(event, context)
        
        # Parse response
        # Expected format: { "statusCode": 200, "body": "...", "headers": {...} }
        
        if isinstance(response, dict) and 'statusCode' in response:
            return response.get('body', ''), response.get('statusCode'), response.get('headers', {})
        else:
            # Fallback for simple return
            return jsonify(response)

    except Exception as e:
        print(f"Error executing handler: {e}")
        return jsonify({"message": "Internal Server Error", "error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)
