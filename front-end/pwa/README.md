# AI-Enhanced CDMS

Angular PWA frontend for the AI-Enhanced CDMS platform. This app provides the browser-based workflows for observation entry, ingestion, data extraction, quality control, administration, and AI-assisted review.

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 16.0.2.

## Development server

Run `npm run start` from this directory, or `npm --prefix front-end/pwa run start` from the repository root. Navigate to `http://localhost:4200/`. The application reloads when source files change.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `npm run build` from this directory, or `npm --prefix front-end/pwa run build` from the repository root. The build artifacts are written to the `dist/` directory.

## LMS AI GenAI Provider

Live Gemini/Groq GenAI requires `LMS_GENAI_PROVIDER` and the matching API key. The `template` provider is used for offline or local validation, and the provider used by a run is recorded in the LMS pipeline manifest.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.
