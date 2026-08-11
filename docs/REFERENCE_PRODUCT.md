# Reference Product and Service Targets

The scaffold is validated against a multi-tenant B2B project/work-management SaaS. Organizations contain members, projects, files, notifications, exports, and third-party webhook integrations.

## Initial service targets

| Target                   | Initial value                                       |
| ------------------------ | --------------------------------------------------- |
| Deployment region        | One region                                          |
| Expected scale           | Hundreds to low thousands of active users           |
| API availability SLO     | 99.9% per month                                     |
| API latency SLO          | p95 reads under 300 ms; p95 writes under 700 ms     |
| Recovery time objective  | 4 hours                                             |
| Recovery point objective | 15 minutes                                          |
| Data classes             | Public, internal, personal, sensitive               |
| Operating model          | Managed services within a documented monthly budget |

These values are planning assumptions, not promises. Revisit them with actual traffic, incident, and cost data before adding scale-oriented infrastructure.
