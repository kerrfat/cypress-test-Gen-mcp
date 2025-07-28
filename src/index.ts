#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import puppeteer, { Browser, Page } from 'puppeteer';
import { ElementHandle } from 'puppeteer';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

/// <reference lib="dom" />

declare global {
  interface Window {
    axe: any;
  }
}

// Types for our element analysis
interface ElementInfo {
  selector: string;
  tag: string;
  type?: string;
  id?: string;
  className?: string;
  text?: string;
  placeholder?: string;
  name?: string;
  role?: string;
  ariaLabel?: string;
  href?: string;
  src?: string;
  interactionType: 'click' | 'input' | 'select' | 'navigation' | 'media';
}

interface PageAnalysis {
  url: string;
  title: string;
  elements: ElementInfo[];
  forms: FormInfo[];
  navigation: NavigationInfo[];
}

interface FormInfo {
  selector: string;
  method?: string;
  action?: string;
  fields: ElementInfo[];
}

interface NavigationInfo {
  selector: string;
  href: string;
  text: string;
}

class CypressTestGenerator {
  private browser: Browser | null = null;

  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
  }

  async createPage() {
    await this.initBrowser();
    return await this.browser!.newPage();
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async scrapePage(url: string): Promise<PageAnalysis> {
    await this.initBrowser();
    const page = await this.browser!.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait a bit for dynamic content to load
      await new Promise((res) => setTimeout(res, 2000));

      const html = await page.content();
      const title = await page.title();

      return this.parseHTML(html, url, title);
    } finally {
      await page.close();
    }
  }

  private parseHTML(html: string, url: string, title: string): PageAnalysis {
    const $ = cheerio.load(html);
    const elements: ElementInfo[] = [];
    const forms: FormInfo[] = [];
    const navigation: NavigationInfo[] = [];

    // Parse interactive elements
    this.parseInteractiveElements($, elements);

    // Parse forms
    this.parseForms($, forms);

    // Parse navigation
    this.parseNavigation($, navigation);

    return {
      url,
      title,
      elements,
      forms,
      navigation,
    };
  }

  private parseInteractiveElements(
    $: cheerio.CheerioAPI,
    elements: ElementInfo[]
  ) {
    // Buttons and clickable elements
    $('button, [role="button"], .btn, .button').each((_, el) => {
      const $el = $(el);
      elements.push({
        selector: this.generateSelector($el),
        tag: el.tagName.toLowerCase(),
        id: $el.attr('id'),
        className: $el.attr('class'),
        text: $el.text().trim(),
        role: $el.attr('role'),
        ariaLabel: $el.attr('aria-label'),
        interactionType: 'click',
      });
    });

    // Input elements
    $('input, textarea, select').each((_, el) => {
      const $el = $(el);
      const type = $el.attr('type') || 'text';

      elements.push({
        selector: this.generateSelector($el),
        tag: el.tagName.toLowerCase(),
        type,
        id: $el.attr('id'),
        className: $el.attr('class'),
        name: $el.attr('name'),
        placeholder: $el.attr('placeholder'),
        ariaLabel: $el.attr('aria-label'),
        interactionType:
          type === 'submit' || type === 'button'
            ? 'click'
            : el.tagName.toLowerCase() === 'select'
              ? 'select'
              : 'input',
      });
    });

    // Links
    $('a[href]').each((_, el) => {
      const $el = $(el);
      elements.push({
        selector: this.generateSelector($el),
        tag: 'a',
        href: $el.attr('href'),
        text: $el.text().trim(),
        ariaLabel: $el.attr('aria-label'),
        interactionType: 'navigation',
      });
    });

    // Media elements
    $('img, video, audio').each((_, el) => {
      const $el = $(el);
      elements.push({
        selector: this.generateSelector($el),
        tag: el.tagName.toLowerCase(),
        src: $el.attr('src'),
        ariaLabel: $el.attr('aria-label') || $el.attr('alt'),
        interactionType: 'media',
      });
    });
  }

  private parseForms($: cheerio.CheerioAPI, forms: FormInfo[]) {
    $('form').each((_, form) => {
      const $form = $(form);
      const fields: ElementInfo[] = [];

      $form
        .find('input, textarea, select, button[type="submit"]')
        .each((_, field) => {
          const $field = $(field);
          const type = $field.attr('type') || 'text';

          fields.push({
            selector: this.generateSelector($field),
            tag: field.tagName.toLowerCase(),
            type,
            id: $field.attr('id'),
            className: $field.attr('class'),
            name: $field.attr('name'),
            placeholder: $field.attr('placeholder'),
            ariaLabel: $field.attr('aria-label'),
            interactionType:
              type === 'submit' || field.tagName.toLowerCase() === 'button'
                ? 'click'
                : field.tagName.toLowerCase() === 'select'
                  ? 'select'
                  : 'input',
          });
        });

      forms.push({
        selector: this.generateSelector($form),
        method: $form.attr('method'),
        action: $form.attr('action'),
        fields,
      });
    });
  }

  private parseNavigation($: cheerio.CheerioAPI, navigation: NavigationInfo[]) {
    $('nav a, .nav a, .navbar a, .menu a').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      if (href) {
        navigation.push({
          selector: this.generateSelector($el),
          href,
          text: $el.text().trim(),
        });
      }
    });
  }

  private generateSelector($el: cheerio.Cheerio<any>): string {
    const id = $el.attr('id');
    if (id) return `#${id}`;

    const dataTestId = $el.attr('data-testid') || $el.attr('data-test-id');
    if (dataTestId) return `[data-testid="${dataTestId}"]`;

    const name = $el.attr('name');
    if (name) return `[name="${name}"]`;

    // Generate a more specific selector based on context
    const tag = $el.prop('tagName')?.toLowerCase();
    const className = $el.attr('class');
    const text = $el.text().trim();

    if (className) {
      const classes = className.split(' ').filter((c) => c.length > 0);
      return `${tag}.${classes.join('.')}`;
    }

    if (text && text.length < 50) {
      return `${tag}:contains("${text}")`;
    }

    // Fallback to nth-child selector
    const index = $el.index();
    return `${tag}:nth-child(${index + 1})`;
  }

  generatePageObject(analysis: PageAnalysis): string {
    const className = this.toPascalCase(this.getPageName(analysis.url));

    return `// Generated Page Object for ${analysis.url}
// Title: ${analysis.title}

export class ${className}Page {
  private readonly url = '${analysis.url}';

  // Element locators
${this.generateLocators(analysis.elements)}

  // Navigation methods
  visit(): void {
    cy.visit(this.url);
  }

  waitForPageLoad(): void {
    cy.url().should('include', '${this.getPagePath(analysis.url)}');
    cy.title().should('contain', '${analysis.title}');
  }

  // Element getter methods
${this.generateGetterMethods(analysis.elements)}

  // Interaction methods
${this.generateInteractionMethods(analysis.elements)}

  // Form methods
${this.generateFormMethods(analysis.forms)}

  // Workflow methods
${this.generateWorkflowMethods(analysis)}
}`;
  }

  private generateLocators(elements: ElementInfo[]): string {
    return elements
      .map((el) => {
        const name = this.generateElementName(el);
        return `  private readonly ${name}Selector = '${el.selector}';`;
      })
      .join('\n');
  }

  private generateGetterMethods(elements: ElementInfo[]): string {
    return elements
      .map((el) => {
        const name = this.generateElementName(el);
        return `  get${this.toPascalCase(name)}(): Cypress.Chainable {
    return cy.get(this.${name}Selector);
  }`;
      })
      .join('\n\n');
  }

  private generateInteractionMethods(elements: ElementInfo[]): string {
    const methods: string[] = [];

    elements.forEach((el) => {
      const name = this.generateElementName(el);
      const pascalName = this.toPascalCase(name);

      switch (el.interactionType) {
        case 'click':
          methods.push(`  click${pascalName}(): void {
    this.get${pascalName}().should('be.visible').click();
  }`);
          break;

        case 'input':
          methods.push(`  type${pascalName}(text: string): void {
    this.get${pascalName}().should('be.visible').clear().type(text);
  }

  clear${pascalName}(): void {
    this.get${pascalName}().should('be.visible').clear();
  }`);
          break;

        case 'select':
          methods.push(`  select${pascalName}(value: string): void {
    this.get${pascalName}().should('be.visible').select(value);
  }`);
          break;
      }
    });

    return methods.join('\n\n');
  }

  private generateFormMethods(forms: FormInfo[]): string {
    return forms
      .map((form, index) => {
        const formName = `Form${index + 1}`;
        const fieldMethods = form.fields
          .filter((field) => field.interactionType === 'input')
          .map((field) => {
            const fieldName = this.generateElementName(field);
            return `    this.type${this.toPascalCase(
              fieldName
            )}(data.${fieldName});`;
          })
          .join('\n');

        const submitField = form.fields.find(
          (field) =>
            field.type === 'submit' ||
            (field.tag === 'button' && field.interactionType === 'click')
        );

        const submitMethod = submitField
          ? `    this.click${this.toPascalCase(
              this.generateElementName(submitField)
            )}();`
          : '    // No submit button found';

        return `  fill${formName}(data: any): void {
${fieldMethods}
  }

  submit${formName}(): void {
${submitMethod}
  }`;
      })
      .join('\n\n');
  }

  private generateWorkflowMethods(analysis: PageAnalysis): string {
    const workflows: string[] = [];

    // Login workflow if login elements are detected
    const emailField = analysis.elements.find(
      (el) =>
        el.name?.toLowerCase().includes('email') ||
        el.id?.toLowerCase().includes('email') ||
        el.type === 'email'
    );
    const passwordField = analysis.elements.find(
      (el) =>
        el.name?.toLowerCase().includes('password') ||
        el.id?.toLowerCase().includes('password') ||
        el.type === 'password'
    );
    const loginButton = analysis.elements.find(
      (el) =>
        el.text?.toLowerCase().includes('login') ||
        el.text?.toLowerCase().includes('sign in')
    );

    if (emailField && passwordField && loginButton) {
      workflows.push(`  login(email: string, password: string): void {
    this.type${this.toPascalCase(this.generateElementName(emailField))}(email);
    this.type${this.toPascalCase(
      this.generateElementName(passwordField)
    )}(password);
    this.click${this.toPascalCase(this.generateElementName(loginButton))}();
  }`);
    }

    // Search workflow if search elements are detected
    const searchField = analysis.elements.find(
      (el) =>
        el.placeholder?.toLowerCase().includes('search') ||
        el.name?.toLowerCase().includes('search') ||
        el.id?.toLowerCase().includes('search')
    );
    const searchButton = analysis.elements.find((el) =>
      el.text?.toLowerCase().includes('search')
    );

    if (searchField) {
      workflows.push(`  search(query: string): void {
    this.type${this.toPascalCase(this.generateElementName(searchField))}(query);
    ${
      searchButton
        ? `this.click${this.toPascalCase(
            this.generateElementName(searchButton)
          )}();`
        : 'cy.get(this.' +
          this.generateElementName(searchField) +
          "Selector).type('{enter}');"
    }
  }`);
    }

    return workflows.join('\n\n');
  }

  generateTestSuite(analysis: PageAnalysis): string {
    const className = this.toPascalCase(this.getPageName(analysis.url));

    return `// Generated Cypress tests for ${analysis.url}
// Title: ${analysis.title}

import { ${className}Page } from '../page-objects/${className}Page';

describe('${analysis.title}', () => {
  let page: ${className}Page;

  beforeEach(() => {
    page = new ${className}Page();
    page.visit();
    page.waitForPageLoad();
  });

  describe('Page Load Tests', () => {
    it('should load the page successfully', () => {
      cy.url().should('include', '${this.getPagePath(analysis.url)}');
      cy.title().should('contain', '${analysis.title}');
    });

    it('should have all critical elements visible', () => {
${this.generateVisibilityTests(analysis.elements)}
    });
  });

  describe('Element Interaction Tests', () => {
${this.generateInteractionTests(analysis.elements)}
  });

  describe('Form Tests', () => {
${this.generateFormTests(analysis.forms)}
  });

  describe('Navigation Tests', () => {
${this.generateNavigationTests(analysis.navigation)}
  });

  describe('Accessibility Tests', () => {
    it('should have proper accessibility attributes', () => {
      cy.injectAxe();
      cy.checkA11y();
    });

    it('should be keyboard navigable', () => {
${this.generateKeyboardTests(analysis.elements)}
    });
  });

  describe('Error Handling Tests', () => {
${this.generateErrorTests(analysis)}
  });

  describe('Performance Tests', () => {
    it('should load within acceptable time', () => {
      const startTime = Date.now();
      page.visit();
      page.waitForPageLoad();
      const loadTime = Date.now() - startTime;
      expect(loadTime).to.be.lessThan(5000);
    });
  });

  describe('Responsive Design Tests', () => {
    ['iphone-6', 'ipad-2', [1920, 1080]].forEach((viewport) => {
      it(\`should display correctly on \${Array.isArray(viewport) ? viewport.join('x') : viewport}\`, () => {
        cy.viewport(viewport as any);
        page.visit();
        page.waitForPageLoad();
        // Add specific responsive assertions here
      });
    });
  });
});`;
  }

  private generateVisibilityTests(elements: ElementInfo[]): string {
    return elements
      .slice(0, 10) // Limit to first 10 elements to avoid overly long tests
      .map((el) => {
        const name = this.generateElementName(el);
        return `      page.get${this.toPascalCase(
          name
        )}().should('be.visible');`;
      })
      .join('\n');
  }

  private generateInteractionTests(elements: ElementInfo[]): string {
    const tests: string[] = [];

    elements.forEach((el) => {
      const name = this.generateElementName(el);
      const pascalName = this.toPascalCase(name);

      switch (el.interactionType) {
        case 'click':
          tests.push(`    it('should be able to click ${name}', () => {
      page.get${pascalName}().should('be.visible').and('not.be.disabled');
      page.click${pascalName}();
    });`);
          break;

        case 'input':
          tests.push(`    it('should be able to type in ${name}', () => {
      const testText = 'test input';
      page.type${pascalName}(testText);
      page.get${pascalName}().should('have.value', testText);
    });`);
          break;

        case 'select':
          tests.push(`    it('should be able to select from ${name}', () => {
      page.get${pascalName}().find('option').then($options => {
        if ($options.length > 1) {
          const value = $options.eq(1).val();
          page.select${pascalName}(value as string);
          page.get${pascalName}().should('have.value', value);
        }
      });
    });`);
          break;
      }
    });

    return tests.join('\n\n');
  }

  private generateFormTests(forms: FormInfo[]): string {
    return forms
      .map((form, index) => {
        const formName = `Form${index + 1}`;
        return `    it('should be able to fill and submit ${formName.toLowerCase()}', () => {
      const testData = {
${form.fields
  .filter((field) => field.interactionType === 'input')
  .map(
    (field) =>
      `        ${this.generateElementName(
        field
      )}: 'test ${this.generateElementName(field)}'`
  )
  .join(',\n')}
      };
      
      page.fill${formName}(testData);
      page.submit${formName}();
      
      // Add assertions for form submission result
    });`;
      })
      .join('\n\n');
  }

  private generateNavigationTests(navigation: NavigationInfo[]): string {
    return navigation
      .slice(0, 5) // Limit to first 5 navigation items
      .map((nav, index) => {
        return `    it('should navigate correctly when clicking navigation item ${
          index + 1
        }', () => {
      cy.get('${nav.selector}').should('be.visible').click();
      // Add assertions for navigation result
    });`;
      })
      .join('\n\n');
  }

  private generateKeyboardTests(elements: ElementInfo[]): string {
    const interactiveElements = elements.filter(
      (el) => el.interactionType === 'click' || el.interactionType === 'input'
    );

    return interactiveElements
      .slice(0, 5)
      .map((el) => {
        const name = this.generateElementName(el);
        return `      page.get${this.toPascalCase(
          name
        )}().focus().should('be.focused');`;
      })
      .join('\n');
  }

  private generateErrorTests(analysis: PageAnalysis): string {
    const tests: string[] = [];

    // Test form validation if forms exist
    if (analysis.forms.length > 0) {
      tests.push(`    it('should handle form validation errors', () => {
      // Submit form with invalid data
      page.submitForm1();
      // Add assertions for validation messages
    });`);
    }

    // Test network errors
    tests.push(`    it('should handle network errors gracefully', () => {
      cy.intercept('GET', '**', { forceNetworkError: true });
      page.visit();
      // Add assertions for error handling
    });`);

    return tests.join('\n\n');
  }

  private generateElementName(element: ElementInfo): string {
    if (element.id) {
      return this.toCamelCase(element.id);
    }

    if (element.name) {
      return this.toCamelCase(element.name);
    }

    if (element.text && element.text.length < 30) {
      return this.toCamelCase(element.text);
    }

    if (element.placeholder) {
      return this.toCamelCase(element.placeholder);
    }

    return `${element.tag}${
      element.type ? this.toPascalCase(element.type) : ''
    }Element`;
  }

  private toCamelCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .replace(/\s+(.)/g, (_, char) => char.toUpperCase())
      .replace(/\s/g, '')
      .replace(/^./, (char) => char.toLowerCase());
  }

  private toPascalCase(str: string): string {
    const camelCase = this.toCamelCase(str);
    return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
  }

  private getPageName(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const segments = pathname.split('/').filter((s) => s.length > 0);
      return segments.length > 0 ? segments[segments.length - 1] : 'home';
    } catch {
      return 'page';
    }
  }

  private getPagePath(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname;
    } catch {
      return '/';
    }
  }
}

// MCP Server setup
const server = new Server(
  {
    name: 'cypress-test-generator',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const generator = new CypressTestGenerator();

// Define available tools
const tools: Tool[] = [
  {
    name: 'scrape_page',
    description:
      'Scrape a web page and analyze its structure for test generation',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the page to scrape and analyze',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'generate_page_object',
    description: 'Generate a TypeScript Page Object class from page analysis',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the page to generate Page Object for',
        },
        outputPath: {
          type: 'string',
          description: 'Optional path to save the generated Page Object file',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'generate_test_suite',
    description: 'Generate comprehensive Cypress test suite from page analysis',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the page to generate tests for',
        },
        outputPath: {
          type: 'string',
          description: 'Optional path to save the generated test file',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'generate_full_test_setup',
    description: 'Generate both Page Object and test suite for a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The URL of the page to generate complete test setup for',
        },
        outputDir: {
          type: 'string',
          description: 'Optional directory to save generated files',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'analyze_accessibility',
    description: 'Analyze a web page for accessibility issues using axe-core',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to analyze' },
      },
      required: ['url'],
    },
  },
  {
    name: 'screenshot_page',
    description: 'Take a screenshot of the page and return as base64',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to screenshot' },
      },
      required: ['url'],
    },
  },
  {
    name: 'extract_text_content',
    description: 'Extract all visible text from a web page',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to extract text from' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_links',
    description: 'List all links and their destinations on a web page',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to list links from' },
      },
      required: ['url'],
    },
  },
  {
    name: 'extract_table_data',
    description: 'Extract data from all tables on a web page',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to extract tables from' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_cookies',
    description: 'Retrieve all cookies for a web page',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to get cookies from' },
      },
      required: ['url'],
    },
  },
  {
    name: 'set_viewport',
    description: 'Set the viewport size before scraping a page',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to visit' },
        width: { type: 'number', description: 'Viewport width' },
        height: { type: 'number', description: 'Viewport height' },
      },
      required: ['url', 'width', 'height'],
    },
  },
];

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  let page: Page | null = null;

  const cleanup = async () => {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error('Error closing page:', e);
      }
      page = null;
    }
  };

  try {
    switch (name) {
      case 'scrape_page': {
        const { url } = args as { url: string };
        const analysis = await generator.scrapePage(url);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(analysis, null, 2),
            },
          ],
        };
      }

      case 'generate_page_object': {
        const { url, outputPath } = args as {
          url: string;
          outputPath?: string;
        };
        const analysis = await generator.scrapePage(url);
        const pageObject = generator.generatePageObject(analysis);

        if (outputPath) {
          await fs.writeFile(outputPath, pageObject, 'utf-8');
        }

        return {
          content: [
            {
              type: 'text',
              text: pageObject,
            },
          ],
        };
      }

      case 'generate_test_suite': {
        const { url, outputPath } = args as {
          url: string;
          outputPath?: string;
        };
        const analysis = await generator.scrapePage(url);
        const testSuite = generator.generateTestSuite(analysis);

        if (outputPath) {
          await fs.writeFile(outputPath, testSuite, 'utf-8');
        }

        return {
          content: [
            {
              type: 'text',
              text: testSuite,
            },
          ],
        };
      }

      case 'generate_full_test_setup': {
        const { url, outputDir } = args as { url: string; outputDir?: string };
        const analysis = await generator.scrapePage(url);
        const pageObject = generator.generatePageObject(analysis);
        const testSuite = generator.generateTestSuite(analysis);

        const className = generator['toPascalCase'](
          generator['getPageName'](url)
        );

        if (outputDir) {
          await fs.mkdir(path.join(outputDir, 'page-objects'), {
            recursive: true,
          });
          await fs.mkdir(path.join(outputDir, 'tests'), { recursive: true });

          await fs.writeFile(
            path.join(outputDir, 'page-objects', `${className}Page.ts`),
            pageObject,
            'utf-8'
          );

          await fs.writeFile(
            path.join(outputDir, 'tests', `${className}.spec.ts`),
            testSuite,
            'utf-8'
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: `Generated Page Object and Test Suite for ${url}\n\n=== PAGE OBJECT ===\n\n${pageObject}\n\n=== TEST SUITE ===\n\n${testSuite}`,
            },
          ],
        };
      }

      case 'analyze_accessibility': {
        const { url } = args as { url: string };
        page = await generator.createPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        // Try to inject axe-core from CDN
        await page.addScriptTag({
          url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.7.2/axe.min.js',
        });
        const results = await page.evaluate(async () => {
          if (window.axe) {
            return await window.axe.run();
          } else {
            return { error: 'axe-core not loaded' };
          }
        });
        await cleanup();
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'screenshot_page': {
        const { url } = args as { url: string };
        page = await generator.createPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const screenshot = await page.screenshot({ encoding: 'base64' });
        await cleanup();
        return { content: [{ type: 'image', image: screenshot }] };
      }

      case 'extract_text_content': {
        const { url } = args as { url: string };
        page = await generator.createPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const text = await page.evaluate(() => {
          return document.body.innerText;
        });
        await cleanup();
        return { content: [{ type: 'text', text }] };
      }

      case 'list_links': {
        const { url } = args as { url: string };
        page = await generator.createPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const links = await page.evaluate(() => {
          const links: Array<{ href: string | null; text: string }> = [];
          document.querySelectorAll('a[href]').forEach((a: Element) => {
            if (a instanceof HTMLAnchorElement) {
              links.push({
                href: a.getAttribute('href'),
                text: a.textContent?.trim() || '',
              });
            }
          });
          return links;
        });
        await cleanup();
        return {
          content: [{ type: 'text', text: JSON.stringify(links, null, 2) }],
        };
      }

      case 'extract_table_data': {
        const { url } = args as { url: string };
        page = await generator.createPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const tables = await page.evaluate(() => {
          const results: Array<{ headers: string[]; rows: string[][] }> = [];
          document.querySelectorAll('table').forEach((table: Element) => {
            if (!(table instanceof HTMLTableElement)) return;

            let headers: string[] = [];
            const thead = table.querySelector('thead');
            if (thead instanceof HTMLTableSectionElement) {
              headers = Array.from(thead.querySelectorAll('th')).map((th) =>
                th instanceof HTMLTableCellElement
                  ? th.textContent?.trim() || ''
                  : ''
              );
            }
            if (headers.length === 0) {
              const firstTr = table.querySelector('tr');
              if (firstTr instanceof HTMLTableRowElement) {
                headers = Array.from(firstTr.querySelectorAll('th,td')).map(
                  (cell) =>
                    cell instanceof HTMLTableCellElement
                      ? cell.textContent?.trim() || ''
                      : ''
                );
              }
            }

            const rows = Array.from(table.querySelectorAll('tr'))
              .map((tr, i) => {
                if (
                  !(tr instanceof HTMLTableRowElement) ||
                  (i === 0 && headers.length > 0)
                )
                  return null;
                const cells = Array.from(tr.querySelectorAll('td')).map((td) =>
                  td instanceof HTMLTableCellElement
                    ? td.textContent?.trim() || ''
                    : ''
                );
                return cells.length > 0 ? cells : null;
              })
              .filter((row): row is string[] => row !== null && row.length > 0);

            results.push({ headers, rows });
          });
          return results;
        });
        await cleanup();
        return {
          content: [{ type: 'text', text: JSON.stringify(tables, null, 2) }],
        };
      }

      case 'get_cookies': {
        const { url } = args as { url: string };
        page = await generator.createPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const cookies = await page.cookies();
        await cleanup();
        return {
          content: [{ type: 'text', text: JSON.stringify(cookies, null, 2) }],
        };
      }

      case 'set_viewport': {
        const { url, width, height } = args as {
          url: string;
          width: number;
          height: number;
        };
        page = await generator.createPage();
        await page.setViewport({ width, height });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const html = await page.content();
        const title = await page.title();
        await cleanup();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                url,
                title,
                viewport: { width, height },
                html,
              }),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
});

// Cleanup on exit
process.on('SIGTERM', async () => {
  await generator.closeBrowser();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await generator.closeBrowser();
  process.exit(0);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Cypress Test Generator MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
