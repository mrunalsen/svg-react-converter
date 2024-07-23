const express = require('express');
const potrace = require('potrace');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 5000;

const upload = multer({ dest: 'uploads/' });
var params = {
    threshold: 180, steps: 4
};

app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    const imagePath = req.file.path;
    const outputSvgPath = './output.svg';

    potrace.trace(imagePath, params, function (err, svg) {
        if (err) {
            console.error('Error tracing image:', err);
            return res.status(500).send('Error tracing image.');
        }

        fs.writeFileSync(outputSvgPath, svg);
        fs.unlink(imagePath, (unlinkErr) => {
            if (unlinkErr) {
                console.error('Error deleting uploaded image:', unlinkErr);
            }
        });

        res.setHeader('Content-Type', 'image/svg+xml');
        res.send(svg);
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
