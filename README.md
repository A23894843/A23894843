# Abhinandan — Cybersecurity & Systems Portfolio

> **Live portfolio:** https://my-portfolio-abhinandan.vercel.app  
> **Repository:** https://github.com/A23894843/A23894843

A production-oriented personal portfolio for **Abhinandan**, a B.Tech Computer Science student focused on **cybersecurity, systems engineering, machine learning and secure full-stack development**.

The project combines a responsive public portfolio with live GitHub/LeetCode activity, a recruiter-facing document room, Supabase authentication, protected admin tooling, contact/query handling and server-side APIs.

## Highlights

- Responsive portfolio homepage with dark/light theme support.
- Mobile navigation with a dedicated **ADMIN CONTROL** section.
- Public project, engineering, activity, achievement and contact sections.
- Live GitHub contribution data through a Vercel API route.
- Live LeetCode statistics through a Vercel API route.
- Public recruiter document room.
- Supabase-powered authentication and protected admin pages.
- Admin document, profile, query and user-management workflows.
- Role and permission controls with audit logging.
- Public contact/query workflow with server-side processing.
- Email delivery support through Nodemailer.
- Scheduled query processing through Vercel Cron.
- Password recovery flow.
- Interactive cursor, scroll, reveal and card effects.
- Responsive desktop, tablet and mobile layouts.

## Featured Projects

### Cyber Defensive Engine

A hybrid network-defence project combining low-level packet capture with machine-learning based anomaly detection.

**Technologies:** C++, libpcap, Python, scikit-learn, PyTorch, Flask/Flask-SocketIO, SQLite and Unix IPC.

The system is designed around packet capture, anomaly detection, logging, alerting and defensive response workflows.

### ZeroContext IDPS

An intrusion-detection project focused on behavioural telemetry and anomaly detection, with a C++ sensor layer, Python ML processing and a FastAPI monitoring interface.

### Dr. Vaccine Antivirus

A Java antivirus prototype using signature-based scanning and object-oriented design.

### Contact Management System

A Python/Tkinter and MySQL CRUD application developed during the CodSoft internship.

### Strong Password Generator

A Python/Tkinter GUI application for configurable password generation.

## Platform Architecture

```text
Browser
   │
   ├── Public Portfolio
   │     ├── Projects
   │     ├── Engineering
   │     ├── Activity
   │     ├── Achievements
   │     └── Contact / Documents
   │
   ├── Guest Document Room
   │
   └── Admin Authentication
           │
           ├── Dashboard
           ├── Profile Management
           ├── Document Management
           ├── Query Management
           ├── Admin Management
           └── Audit Log
                    │
                    ▼
              Supabase + Vercel APIs
                    │
                    └── Nodemailer / SMTP
```

## Technology Stack

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- Inter
- Space Grotesk
- DM Mono

### Backend / Services

- Vercel Serverless Functions
- Supabase Auth
- Supabase PostgreSQL
- Nodemailer
- SMTP
- Vercel Cron

### Development

- Git
- GitHub
- Node.js 20+
- npm

Current `package.json` dependencies include `@supabase/supabase-js` and `nodemailer`.

## Repository Structure

```text
A23894843/
├── index.html                 # Public portfolio
├── contact.html               # Public contact/query page
├── reset-password.html        # Password recovery destination
├── admin-queries.html         # Legacy/admin query page
├── admin/                     # Protected admin interface
├── guest/                     # Public/recruiter document room
├── auth-pages/                # Authentication pages
├── api/                       # Vercel serverless API routes
├── lib/                       # Shared server-side helpers
├── assets/                    # Portfolio assets
├── supabase/                  # Database/migration material
├── package.json
├── vercel.json
├── .env.example
└── README.md
```

> **Security note:** `admin/config.js` is intentionally not documented or modified as part of public portfolio changes.

## Authentication & Admin System

The admin side uses Supabase authentication and server-side authorization.

Supported capabilities include:

- Admin login and signup
- Password recovery
- Protected admin routes
- Approved-admin status
- Owner/admin/support roles
- Granular permissions
- Dashboard access
- Profile management
- Document management
- Query management
- Admin management
- Audit logging

The public website exposes only the required entry points. Internal admin capabilities remain behind authentication and authorization.

## Documents

The portfolio includes a recruiter-facing document room.

- Public documents can be previewed by visitors.
- Private documents remain restricted to authorized administrators.
- Download permissions are enforced server-side.
- Administrators can manage document visibility and access behavior.

## Contact & Query System

The public contact workflow stores incoming queries and supports administrative handling.

The backend supports:

- Query status tracking
- Admin replies
- Email delivery through Nodemailer
- Scheduled processing
- Reminder processing
- Audit logging

The current Vercel configuration schedules the query scheduler once per day, compatible with Vercel Hobby cron limits.

## Environment Variables

Create a local `.env` from `.env.example` and configure the deployment environment with the required server-side values.

Typical server configuration includes:

```text
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=...
```

**Never commit real Supabase service keys, SMTP passwords or other secrets to GitHub.**

For Gmail SMTP, use a Google App Password rather than the normal Gmail account password.

## Local Development

Install dependencies:

```bash
npm install
```

For a quick static frontend preview:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

> The complete server-side functionality depends on the Vercel/Supabase environment and deployed API routes, so a plain static server is intended for frontend inspection only.

## Deployment

The project is structured for Vercel deployment:

1. Connect the GitHub repository to Vercel.
2. Configure the required environment variables.
3. Deploy the `main` branch.
4. Verify the public portfolio.
5. Verify Supabase authentication and redirect URLs.
6. Verify serverless API routes.
7. Verify document access rules.
8. Verify query/email processing.

**Live deployment:** https://my-portfolio-abhinandan.vercel.app

## Professional Links

- **Portfolio:** https://my-portfolio-abhinandan.vercel.app
- **GitHub:** https://github.com/A23894843
- **LinkedIn:** https://www.linkedin.com/in/abhinandan-29b66b28b/
- **LeetCode:** https://leetcode.com/u/a23894843/
- **Email:** a23894843@gmail.com

## Education & Focus

**B.Tech — Computer Science & Engineering**  
Gurukul Kangri Vishwavidyalaya, Haridwar

Current technical focus:

- Cybersecurity
- Network defence
- Systems engineering
- Machine learning
- Data structures & algorithms
- Secure full-stack development
- Linux
- C++
- Python
- Java
- SQL

## Engineering Philosophy

**Build → Measure → Explain**

Each major project is presented with its purpose, technical stack and engineering context rather than only showing a finished interface.

---

<div align="center">

**Secure Systems · Intelligent Solutions · Real Impact**

</div>
