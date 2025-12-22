# Coding Standards

This document outlines the coding standards and best practices for the `chatoneverything` project. It is intended for both human developers and LLM assistants to ensure code quality, maintainability, and security.

## 1. General Principles

*   **Clarity over Cleverness**: Write code that is easy to read and understand.
*   **Consistency**: Follow the existing patterns unless they are explicitly identified as anti-patterns to be refactored.
*   **Modularity**: Keep components small, focused, and loosely coupled.
*   **Safety**: Prioritize security and robust error handling.

## 2. Code Style

*   **Language**: JavaScript (ES6+) for Node.js and Electron.
*   **Formatting**:
    *   Use 4 spaces for indentation.
    *   Use semicolons `;` at the end of statements.
    *   Use single quotes `'` for strings, backticks `` ` `` for template literals.
    *   Use `const` by default, `let` if reassignment is needed. Avoid `var`.
*   **Naming Conventions**:
    *   **Variables/Functions**: `camelCase` (e.g., `userSession`, `handleMessage`).
    *   **Classes**: `PascalCase` (e.g., `WebServer`, `CeeAgent`).
    *   **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`, `DEFAULT_PORT`).
    *   **Private Methods**: Prefix_with_underscore (e.g., `_captureScreenshot`).

## 3. Error Handling

*   **Never Swallow Errors**: Avoid empty `catch` blocks. Always log the error or handle it gracefully.
    *   *Bad*: `try { ... } catch (e) {}`
    *   *Good*: `try { ... } catch (e) { console.error('Failed to operation:', e); }`
*   **Async/Await**: Prefer `async/await` over raw Promises/callbacks.
*   **Validation**: Validate external inputs (IPC messages, HTTP requests, WebSocket messages) before processing.

## 4. Security

*   **Input Sanitization**: Always sanitize user input before using it in:
    *   Shell commands (avoid `exec` with user input; use `spawn` with argument arrays).
    *   HTML rendering (prevent XSS).
    *   File system paths (prevent directory traversal).
*   **Secrets**: Never hardcode API keys or passwords. Use environment variables or secure configuration stores.
*   **Exposure**: Be careful what data is sent to the client/renderer. Do not send server-side secrets to the frontend.

## 5. Logging

*   **Structured Logging**: In the future, prefer structured logging (JSON). For now, ensure log messages are descriptive.
*   **Levels**:
    *   `console.error`: For errors that require attention.
    *   `console.warn`: For potentially issues or deprecated usage.
    *   `console.log`: For general informational messages (startup, connections).
    *   `console.debug`: For verbose debugging info (disable in production).

## 6. Architecture & Electron

*   **IPC**: Keep IPC channels minimal and focused. Validate all arguments in `ipcMain` handlers.
*   **State**: Avoid global variables where possible. Encapsulate state within Classes or Modules.
*   **Performance**:
    *   Avoid blocking the main thread.
    *   Use `requestAnimationFrame` for UI updates if applicable.
    *   Manage resources (close sockets, file handles) properly.

## 7. LLM Interactions

*   **Context**: When modifying code, read the surrounding code to match the style.
*   **Explanation**: Explain *why* a change is made, especially for complex logic.
*   **Testing**: When writing new logic, verify it does not break existing functionality.

## 8. Specific Patterns

*   **Web Server**: Ensure `http` and `ws` servers handle errors and timeouts (e.g., slow clients).
*   **Remote Control**: Ensure `nut.js` and `dotool` logic handles missing references or platform incompatibilities gracefully.
