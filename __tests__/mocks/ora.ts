export default {
    start: jest.fn(() => ({
        succeed: jest.fn(),
        fail: jest.fn(),
        stop: jest.fn(),
    })),
    succeed: jest.fn(),
    fail: jest.fn(),
    stop: jest.fn(),
};
