module.exports = {
    "env": {
        "browser": true,
        "commonjs": true,
        "es2021": true,
        "node": true
    },
    "extends": [
        "eslint:recommended",
        "prettier"
    ],
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    "rules": {
        "no-unused-vars": "warn",
        "no-console": "warn"
    },
    "globals": {
        "window": "readonly",
        "document": "readonly",
        "navigator": "readonly",
        "localStorage": "readonly",
        "alert": "readonly"
    }
};
