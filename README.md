
# RELISTED – Backend
Relisted is a curated fashion rental marketplace designed to simplify how people access premium fashion without ownership. The platform empowers fashion curators to monetize their wardrobes and designs by renting them out, while providing dressers with access to unique, high-quality outfits for events, shoots, weddings, parties, and more.

Through an intuitive interface, Relisted offers essential tools such as curated fashion listings, rental duration selection, secure payments, and return tracking. A robust admin and curator dashboard allows efficient management of listings, bookings, payments, and availability.

The **RELISTED Backend** powers the core business logic, authentication, payments, and data management for the Relisted platform.
It is built with scalability, security, and maintainability in mind, using modern backend technologies and best practices.

---

## 📌 Project Overview

RELISTED is a platform designed to handle secure user authentication, transactions, and media management at scale.
This backend service exposes RESTful APIs consumed by the frontend and other services.

Key responsibilities of the backend include:

* User authentication & authorization
* Secure payment processing
* Database management and data integrity
* Media upload and management
* Business logic enforcement
* API security and validation

---

## 🛠 Tech Stack

The backend is built using the following technologies:

### Core Technologies

* **NestJS** – Scalable Node.js framework for building efficient server-side applications
* **PostgreSQL** – Relational database for persistent data storage
* **Prisma ORM** – Type-safe database access and migrations
* **JWT (JSON Web Tokens)** – Authentication and authorization
* **Cloudinary** – Media storage and image management
* **Wema Bank Payment Gateway** – Payment processing and transaction handling

---

## 🔐 External Services & Accounts

Some services used in this project require external accounts and credentials.

To avoid exposing sensitive information in this repository:

* All setup instructions, API keys, and credentials for:

  * **Wema Bank**
  * **Cloudinary**
  * **Database credentials**
  * **JWT secrets**
* are documented in a **secure Google Docs file**

👉 **Access details will be shared privately with authorized contributors**


---

## ⚙️ Getting Started

### Prerequisites

Make sure you have the following installed:

* **Node.js** (v18+ recommended)
* **PostgreSQL**
* **npm** or **yarn**
* **Git**

---

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/your-org/RELISTED-Backend.git
cd RELISTED-Backend
```

---

### 2️⃣ Install Dependencies

```bash
npm install
```

or

```bash
yarn install
```

---

### 3️⃣ Environment Variables

Create a `.env` file in the root directory.

The required environment variables and example values are documented in the **secure Google Docs** shared with the team.

> ⚠️ Never commit `.env` files to this repository.

---

### 4️⃣ Database Setup

Run Prisma migrations:

```bash
npx prisma migrate dev
```

Generate Prisma client:

```bash
npx prisma generate
```

---

### 5️⃣ Run the Application

```bash
npm run start:dev
```

The server should now be running on:

```
http://localhost:3000
```

---

## 🧪 Scripts

Commonly used scripts:

```bash
npm run start          # Start production server
npm run start:dev      # Start development server
npm run build          # Build the application
npm run lint           # Lint the codebase
npm run prisma:studio  # Open Prisma Studio
```

---

## 🔑 Authentication

* Authentication is handled using **JWT**
* Protected routes use NestJS guards
* Tokens are issued on login and validated on each request

---

## 💳 Payments (Wema Bank)

* All payment logic is encapsulated in the `payments` module
* Secure verification is done server-side
* Webhooks (if enabled) are validated before processing

> Detailed setup and credentials are available in the secure documentation.

---

## ☁️ Media Uploads (Cloudinary)

* Used for storing and optimizing images and media
* Uploads are handled server-side for security
* Supports signed uploads and transformations

---

## 🤝 Contributing Guide

We welcome contributions from the team. Please follow these guidelines:

### Branching Strategy

* `main` → production-ready code
* `develop` → active development
* Feature branches:

  ```bash
  feature/<feature-name>
  bugfix/<bug-name>
  ```

---

### Contribution Steps

1. Create a new branch from `develop`
2. Make your changes
3. Ensure the app builds and passes lint checks
4. Commit with clear messages
5. Open a Pull Request to `develop`
6. Request review from at least one team member

---

### Commit Message Format

```text
feat: add payment verification endpoint
fix: resolve jwt expiration bug
refactor: clean up user service logic
```

---

## 🛡 Security Notes

* Do **not** commit secrets, keys, or credentials
* Follow least-privilege access principles
* All sensitive configs live outside the repository

---

## 📄 License

This project is private and proprietary.
Unauthorized use or distribution is prohibited.

---

