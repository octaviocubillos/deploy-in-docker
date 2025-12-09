
import { FileStack } from '../src/config';
import * as path from 'path';

// Use the stack.yaml from the test directory
const stackPath = path.resolve(__dirname, '../../test/stack.yaml');

console.log(`Loading stack from: ${stackPath}`);

try {
    const stack = new FileStack({ file: stackPath, profile: 'local' });
    const resources = stack.getResources();

    console.log("Resolved Resources:");
    console.log(JSON.stringify(resources, null, 2));

} catch (error) {
    console.error("Error:", error);
}
