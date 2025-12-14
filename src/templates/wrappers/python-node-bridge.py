import sys
import json
import importlib.util
import os

# Adds current directory to sys.path
sys.path.append(os.getcwd())

def load_handler(file_name, handler_name):
    try:
        spec = importlib.util.spec_from_file_location("user_module", f"{file_name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return getattr(module, handler_name)
    except Exception as e:
        print(json.dumps({"error": f"Failed to load handler: {str(e)}"}), file=sys.stderr)
        sys.exit(1)

def main():
    # Read input from stdin
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"error": "No input received"}), file=sys.stderr)
            sys.exit(1)
            
        payload = json.loads(input_data)
        event = payload.get('event', {})
        context = payload.get('context', {}) # Mock context if needed

        handler = load_handler("{{FILENAME}}", "{{HANDLER_NAME}}")
        
        # Execute Handler
        response = handler(event, context)
        
        # Print response to stdout encoded as JSON
        print(json.dumps(response))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
