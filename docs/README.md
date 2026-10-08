# Visual Nerve documentation

For normal product use, start with the
[Guide](https://www.visualnerve.com/help/). It contains task-oriented
instructions and real Light/Dark screenshots. This directory documents the
implementation, supported contracts and operation of the project.

## Start here

| Topic                                | Document                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project overview and quick start     | [README](../README.md)                                                                                                                                                      |
| Bugs, requests and questions         | [Support](../SUPPORT.md)                                                                                                                                                    |
| Development and tests                | [Development](../DEVELOPMENT.md), [Contributing](../CONTRIBUTING.md)                                                                                                        |
| Architecture and canonical data      | [Architecture](../ARCHITECTURE.md), [Data model](../DATA_MODEL.md)                                                                                                          |
| Storage and backups                  | [Storage](STORAGE.md)                                                                                                                                                       |
| Encrypted workspaces and sessions    | [Schema and limits](ENCRYPTED_WORKSPACE_SCHEMA.md), [implementation plan](ENCRYPTED_WORKSPACE_PLAN.md), [acceptance evidence](acceptance/2026-10-08-encrypted-workspace.md) |
| Privacy and private security reports | [Privacy](PRIVACY.md), [Security](../SECURITY.md)                                                                                                                           |

## Feature contracts

| Area                        | Documents                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local API and MCP           | [API](../API.md), [OpenAPI](openapi.yaml), [MCP](MCP.md)                                                                                                                   |
| Imports and analysis        | [CSV explorer](CSV_EXPLORER.md), [SQL](SQL_IMPORT.md), [code/project ZIP](CODE_IMPORT.md), [draw.io/Visio](DIAGRAM_IMPORT.md), [connected analysis](ANALYSIS_WORKFLOWS.md) |
| Process Simulator           | [Model and engine](PROCESS_SIMULATOR.md), [acceptance criteria](PROCESS_SIMULATOR_ACCEPTANCE.md)                                                                           |
| Diagrams and explanation    | [3D](SPATIAL_DIAGRAMS.md), [drawing](DRAWING.md), [understanding](UNDERSTANDING.md)                                                                                        |
| Presentations and handoffs  | [Player/storyboards](PRESENTATION.md), [speech](SPEECH.md), [Lovable](LOVABLE.md)                                                                                          |
| JSON, SVG and other exports | [Export formats](../EXPORT_FORMAT.md)                                                                                                                                      |
| Mobile design               | [Mobile](MOBILE.md)                                                                                                                                                        |

## Operation and maintenance

| Area                                     | Documents                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Website, consent and assets              | [Website](WEBSITE.md)                                                                                          |
| User help and real screenshots           | [Help maintenance](HELP.md)                                                                                    |
| Manual staging and reviewed production   | [Deployment](DEPLOYMENT.md)                                                                                    |
| Isolated app origin and private hosting  | [App hosting, transfer and publication](APP_ORIGIN_DEPLOYMENT.md)                                              |
| Public repository and launch maintenance | [Repository readiness](REPOSITORY_READINESS.md)                                                                |
| Project and third-party licenses         | [Licensing](LICENSING.md), [dependencies](../DEPENDENCIES.md), [NOTICE](../NOTICE)                             |
| Requirements and verification records    | [Requirements](REQUIREMENTS.md), [acceptance log](ACCEPTANCE.md), [quality audit](QUALITY_AUDIT_2026-10-07.md) |

Verification records describe the revisions and environments actually tested.
They are not blanket performance guarantees. The feature guides document current
input limits, experimental settings and browser constraints.
