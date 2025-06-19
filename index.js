// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const MarkdownIt = require('markdown-it');

const authMiddleware = require('./authMiddleware');

// --- Initialization ---
let serviceAccount;
serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const md = new MarkdownIt();
const app = express();
const PORT = process.env.PORT || 5001;

// --- MIDDLEWARE ---
const allowedOrigins = [
  process.env.FRONTEND_URL,   //  deployed Netlify URL
  'http://localhost:5173'     //  local development URL
];

const corsOptions = {
  origin: function (origin, callback) {
    // The 'origin' is the URL of the site making the request.
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
// --- Middleware ---
app.use(cors(corsOptions)); 
app.use(express.json({ limit: '5mb' })); // Increase payload limit for large resumes

// --- CHANGE 1: Global variable to hold the single browser instance ---
let browserInstance;

// --- CHANGE 2: Function to start and configure the browser once ---
async function startBrowser() {
  let browserOptions;
  if (process.env.RENDER) {
    console.log('Initializing browser for production (Render)...');
    browserOptions = {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    };
  } else {
    console.log('Initializing browser for local development...');
    browserOptions = {
      headless: true,
    };
  }
  browserInstance = await puppeteer.launch(browserOptions);
  console.log('Browser initialized successfully.');
}
// --- ROUTES ---
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to the ResumeForge API!',
    status: 'Service is running',
    timestamp: new Date().toISOString(),
    documentation: 'For API usage, please refer to the project documentation.'
  });
});
// === DOCUMENT CRUD ROUTES ===

// GET all documents for the logged-in user
app.get('/api/documents', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const documentsSnapshot = await db.collection('documents').where('userId', '==', uid).get();
    const documents = documentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json(documents);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).send({ message: 'Error fetching documents' });
  }
});

// POST a new document
app.post('/api/documents', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const { companyName, positionName, resumeMarkdown, coverLetterMarkdown } = req.body;

    const newDoc = {
      userId: uid,
      companyName,
      positionName,
      resumeMarkdown,
      coverLetterMarkdown,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('documents').add(newDoc);
    res.status(201).json({ id: docRef.id, ...newDoc });
  } catch (error) {
    console.error('Error creating document:', error);
    res.status(500).send({ message: 'Error creating document' });
  }
});

// PUT (Update) a specific document
app.put('/api/documents/:id', authMiddleware, async (req, res) => {
    try {
        const { uid } = req.user;
        const docId = req.params.id;
        const data = req.body;

        const docRef = db.collection('documents').doc(docId);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).send({ message: 'Document not found.' });
        }

        // Security check: ensure the user owns this document
        if (doc.data().userId !== uid) {
            return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
        }

        await docRef.update(data);
        res.status(200).json({ message: 'Document updated successfully.' });

    } catch (error) {
        console.error('Error updating document:', error);
        res.status(500).send({ message: 'Error updating document.' });
    }
});


// DELETE a specific document
app.delete('/api/documents/:id', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const docId = req.params.id;

    const docRef = db.collection('documents').doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send({ message: 'Document not found.' });
    }

    // Security check: ensure the user owns this document
    if (doc.data().userId !== uid) {
      return res.status(403).send({ message: 'Forbidden: You do not own this document.' });
    }

    await docRef.delete();
    res.status(200).json({ message: 'Document deleted successfully.' });

  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).send({ message: 'Error deleting document.' });
  }
});


// === PDF GENERATION ROUTE ===
app.post('/api/generate-pdf', authMiddleware, async (req, res) => {
  let page = null; // A page is created for each request, not a whole browser

  try {
    const { markdownContent, filename } = req.body;
    if (!markdownContent) {
      return res.status(400).send({ message: 'Markdown content is required.' });
    }

    const htmlContent = md.render(markdownContent);
    const pdfStyles = fs.readFileSync('./pdf-styles.css', 'utf8');
    const fullHtml = `
      <!DOCTYPE html><html><head><style>${pdfStyles}</style></head>
      <body><div class="resume-preview">${htmlContent}</div></body></html>`;

    // --- CHANGE 3: Use the single browser instance to create a new page ("tab") ---
    page = await browserInstance.newPage();

    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '30px', right: '30px', bottom: '30px', left: '30px' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename || 'document.pdf'}`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send({ message: 'Error generating PDF.' });
  } finally {
    // --- CHANGE 4: Critical step! Always close the page to free up memory. ---
    if (page) {
      await page.close();
    }
  }
});

// This ensures the browser is ready before we start accepting requests.
async function startServer() {
  try {
    await startBrowser();
    app.listen(PORT, () => {
      console.log(`Server is listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start the server or browser:', error);
    process.exit(1);
  }
}

// Start the application
startServer();