// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
// --- CHANGE 1: Use puppeteer-core which is lighter and expects a provided browser ---
const puppeteer = require('puppeteer-core');
const chromium  = require('@sparticuz/chromium');
const fs = require('fs');
const MarkdownIt = require('markdown-it');

const authMiddleware = require('./authMiddleware');

// --- Initialization ---
let serviceAccount;
// if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
// } else {
//   serviceAccount = require('./serviceAccountKey.json');
// }

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const md = new MarkdownIt();
const app = express();
const PORT = process.env.PORT || 5001;

// --- Middleware ---
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173'
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

// --- Global browser instance ---
let browserInstance;

// startBrowser function that handles both environments ---
// --- The Final, Correct startBrowser function ---
async function startBrowser () {
  const runningOnRender = !!process.env.RENDER;

  const browserOptions = runningOnRender
    ? {                          // production
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(), // <-- key line
        headless: 'shell',        // or true
        ignoreHTTPSErrors: true,
      }
    : {                          // local dev
        headless: 'shell',
        channel: 'chrome',
      };

  browserInstance = await puppeteer.launch(browserOptions);
  console.log('Browser initialized.');
}

//   ROUTES: / , /api/documents, etc. 
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Welcome to the ResumeForge API!',
    status: 'Service is running',
    timestamp: new Date().toISOString(),
    documentation: 'For API usage, please refer to the project documentation.'
  });
});
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
app.delete('/api/documents/:id', authMiddleware, async (req, res) => {
  try {
    const { uid } = req.user;
    const docId = req.params.id;

    const docRef = db.collection('documents').doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send({ message: 'Document not found.' });
    }
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

// === PDF GENERATION ROUTE (NO CHANGES NEEDED HERE) ===
app.post('/api/generate-pdf', authMiddleware, async (req, res) => {
  let page = null;

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

    // Use the single browser instance to create a new page
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
    // IMPORTANT: Check  Render logs for the output of this error!
    console.error('Error generating PDF:', error);
    res.status(500).send({ message: 'Error generating PDF.' });
  } finally {
    if (page) {
      await page.close();
    }
  }
});

// --- Server Startup ---
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

startServer();