# Cypress Test Generator MCP Server

A Model Context Protocol (MCP) server that automatically generates Cypress test cases and Page Object Models by scraping and analyzing web pages.

## 🚀 Features

- **Intelligent Web Scraping**: Uses Puppeteer to render pages and extract interactive elements
- **Smart Element Detection**: Identifies buttons, inputs, forms, navigation, and media elements
- **Page Object Generation**: Creates TypeScript Page Object classes with locators and methods
- **Comprehensive Test Suites**: Generates tests for functionality, accessibility, performance, and error handling
- **Workflow Recognition**: Automatically detects common patterns like login and search workflows

## 📦 Installation

1. Clone or create the project directory:
```bash
mkdir cypress-test-generator-mcp
cd cypress-test-generator-mcp
```

2. Initialize and install dependencies:
```bash
npm install
```

3. Build the TypeScript code:
```bash
npm run build
```

4. Configure your MCP client to use the server (add to your MCP configuration file):
```json
{
  "mcpServers": {
    "cypress-test-generator": {
      "command": "node",
      "args": ["path/to/cypress-test-generator-mcp/dist/index.js"]
    }
  }
}
```

## 🛠️ Available Tools

### 1. `scrape_page`
Analyzes a web page and returns its structure.

**Parameters:**
- `url` (string): The URL to scrape and analyze

**Example:**
```javascript
// Returns detailed analysis of page elements, forms, and navigation
await tools.scrape_page({ url: "https://example.com/login" })
```

### 2. `generate_page_object`
Creates a TypeScript Page Object class from a URL.

**Parameters:**
- `url` (string): The URL to generate Page Object for
- `outputPath` (string, optional): File path to save the generated class

**Example:**
```javascript
await tools.generate_page_object({ 
  url: "https://example.com/login",
  outputPath: "./page-objects/LoginPage.ts"
})
```

### 3. `generate_test_suite`
Generates comprehensive Cypress tests for a page.

**Parameters:**
- `url` (string): The URL to generate tests for
- `outputPath` (string, optional): File path to save the test file

**Example:**
```javascript
await tools.generate_test_suite({ 
  url: "https://example.com/login",
  outputPath: "./tests/login.spec.ts"
})
```

### 4. `generate_full_test_setup`
Generates both Page Object and test suite for complete test setup.

**Parameters:**
- `url` (string): The URL to generate complete setup for
- `outputDir` (string, optional): Directory to save all generated files

**Example:**
```javascript
await tools.generate_full_test_setup({ 
  url: "https://example.com/login",
  outputDir: "./cypress-tests"
})
```

## 📋 Generated Code Examples

### Page Object Example
```typescript
export class LoginPage {
  private readonly url = 'https://example.com/login';
  private readonly emailInputSelector = '#email';
  private readonly passwordInputSelector = '#password';
  private readonly loginButtonSelector = '.login-btn';

  visit(): void {
    cy.visit(this.url);
  }

  getEmailInput(): Cypress.Chainable {
    return cy.get(this.emailInputSelector);
  }

  typeEmailInput(text: string): void {
    this.getEmailInput().should('be.visible').clear().type(text);
  }

  login(email: string, password: string): void {
    this.typeEmailInput(email);
    this.typePasswordInput(password);
    this.clickLoginButton();
  }
}
```

### Test Suite Example
```typescript
describe('Login Page', () => {
  let page: LoginPage;

  beforeEach(() => {
    page = new LoginPage();
    page.visit();
    page.waitForPageLoad();
  });

  describe('Element Interaction Tests', () => {
    it('should be able to type in email input', () => {
      const testText = 'test@example.com';
      page.typeEmailInput(testText);
      page.getEmailInput().should('have.value', testText);
    });
  });

  describe('Accessibility Tests', () => {
    it('should have proper accessibility attributes', () => {
      cy.injectAxe();
      cy.checkA11y();
    });
  });
});
```

## 🎯 Use Cases

### 1. **Rapid Test Development**
```javascript
// Generate complete test setup for a new page
await tools.generate_full_test_setup({ 
  url: "https://myapp.com/dashboard",
  outputDir: "./tests/dashboard"
})
```

### 2. **Page Object Maintenance**
```javascript
// Regenerate Page Object when UI changes
await tools.generate_page_object({ 
  url: "https://myapp.com/updated-form",
  outputPath: "./page-objects/UpdatedFormPage.ts"
})
```

### 3. **Cross-browser Testing Setup**
```javascript
// Generate tests for multiple pages
const pages = [
  "https://myapp.com/login",
  "https://myapp.com/signup", 
  "https://myapp.com/profile"
];

for (const url of pages) {
  await tools.generate_full_test_setup({ url, outputDir: "./tests" });
}
```

### 4. **Regression Testing**
```javascript
// Quickly generate tests for critical user journeys
await tools.generate_test_suite({ 
  url: "https://myapp.com/checkout",
  outputPath: "./tests/critical/checkout.spec.ts"
})
```

## 🔧 Configuration Options

### Puppeteer Configuration
The server uses Puppeteer with these default settings:
- Headless mode enabled
- Network idle wait strategy
- 30-second timeout
- Sandbox disabled for Docker compatibility

### Element Detection
The scraper identifies:
- **Interactive Elements**: buttons, inputs, selects, links
- **Forms**: with field analysis and submission detection  
- **Navigation**: menu items and navigation links
- **Media**: images, videos, audio elements
- **Accessibility**: ARIA labels, roles, and attributes

### Selector Priority
1. `id` attributes
2. `data-testid` or `data-test-id` attributes
3. `name` attributes
4. CSS classes
5. Text content (for short text)
6. nth-child selectors (fallback)

## 🏗️ Project Structure
```
cypress-test-generator-mcp/
├── src/
│   └── index.ts          # Main MCP server code
├── dist/                 # Compiled JavaScript
├── page-objects/         # Generated Page Objects
├── tests/               # Generated test suites
├── package.json
├── tsconfig.json
└── README.md
```

## 🔍 Advanced Features

### Workflow Detection
The generator automatically detects common workflows:
- **Login flows**: email/password + submit button
- **Search functionality**: search input + search button
- **Form submissions**: form fields + submit actions

### Test Categories
Generated tests include:
- **Functional tests**: Element interactions and workflows
- **Accessibility tests**: ARIA compliance and keyboard navigation
- **Performance tests**: Page load timing
- **Responsive tests**: Multiple viewport sizes
- **Error handling**: Network errors and validation

### Smart Naming
Elements are intelligently named based on:
- ID attributes (`#user-email` → `userEmailInput`)
- Name attributes (`name="password"` → `passwordInput`)
- Placeholder text (`placeholder="Search..."` → `searchInput`)
- Button text (`"Sign In"` → `signInButton`)

## 🚨 Error Handling

The server includes robust error handling for:
- Invalid URLs or unreachable pages
- Timeout issues during page loading
- Puppeteer browser launch failures
- File system write errors
- Malformed HTML parsing

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details