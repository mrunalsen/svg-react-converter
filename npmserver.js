const express = require('express');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

app.use(cors());
const port = process.env.PORT || 1000;

// Fetch SVGs from provided API
const fetchSVGsForProject = async (projectId, page, perPage, sort) => {
    console.log(`Fetching SVGs for project ${projectId} with page: ${page}, perPage: ${perPage}, sort: ${sort}`);
    const response = await axios.post(`http://172.16.0.5:8088/api/project/${projectId}/icons`, {
        params: { page, perPage, sort }
    });
    const icons = response?.data?.result?.icons || [];

    const svgFiles = {};

    for (const icon of icons) {
        const iconName = icon.iconName;
        for (const iconImage of icon.iconImages) {
            const svgResponse = await axios.get(` http://172.16.0.5:8088/${iconImage.iconImagePath}`, {
                responseType: 'text'
            });
            // svgFiles[iconImage.imageName] = svgResponse.data;
            if (!svgFiles[iconName]) {
                svgFiles[iconName] = [];
            }

            // Add the SVG content to the array associated with the iconName
            svgFiles[iconName].push(svgResponse.data);
        }
    }

    return svgFiles;
};

// Convert SVGs to React components
const convertSVGsToComponents = async (svgFiles) => {
    const jsxComponents = [];
    const tsxComponents = [];
    const indexJsExports = [];
    const indexTsExports = [];
    const declarationFiles = [];

    // const toPascalCase = (str) => {
    //     return str
    //         .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    //         .replace(/^./, (c) => c.toUpperCase());
    // };
    const toPascalCase = (str) => {
        return str
            .split(/[\s_-]+/)   // Split by spaces, hyphens, or underscores
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))  // Capitalize the first letter of each word
            .join('');  // Join the words together without spaces
    };


    for (const iconName in svgFiles) {
        // const svg = svgFiles[fileName];
        // const baseFileName = toPascalCase(fileName.replace('.svg', ''));
        const svgArray = svgFiles[iconName];
        const baseFileName = toPascalCase(iconName);
        const cleanedSVG = svgArray.map(svg => svg.replace(/<svg[^>]*>/, (match) => {
            return match
                .replace(/\sid="[^"]*"/, '')
                .replace(/\sheight="[^"]*"/, '')
                .replace(/\swidth="[^"]*"/, '')
                .replace(/\sviewBox="[^"]*"/, ' viewBox="0 0 512 512"')
                .replace(/\senable-background="[^"]*"/, '')
                .replace(/\scolor="[^"]*"/, ' color="black"');
        })).join('\n');

        const jsxComponent = `
      import React from 'react';

      const ${baseFileName} = (props) => (
        ${cleanedSVG.replace('<svg', '<svg {...props}')}
      );

      export default ${baseFileName};
    `;

        const tsxComponent = `
      import * as React from "react";
      import type { SVGProps } from "react";

      interface IProps extends SVGProps<SVGSVGElement> {
        height: number | string;
        width: number | string;
      }

      const ${baseFileName}: React.FC<IProps> = (props) => {
        const { height, width, ...rest } = props;
        return (
          ${cleanedSVG.replace('<svg', `<svg height={height} width={width} {...rest}`)}
        );
      };

      export default ${baseFileName};
    `;

        const declarationFile = `
      import * as React from "react";
      import { SVGProps } from "react";

      export interface IProps extends SVGProps<SVGSVGElement> {
        height: number | string;
        width: number | string;
      }

      declare const ${baseFileName}: React.FC<IProps>;
      export default ${baseFileName};
    `;

        jsxComponents.push({ fileName: `${baseFileName.replace('.svg', '')}.jsx`, content: jsxComponent });
        tsxComponents.push({ fileName: `${baseFileName.replace('.svg', '')}.tsx`, content: tsxComponent });
        declarationFiles.push({ fileName: `${baseFileName.replace('.svg', '')}.d.ts`, content: declarationFile });
        indexJsExports.push(`export { default as ${baseFileName} } from "./${baseFileName}";`);
        indexTsExports.push(`export { default as ${baseFileName} } from "./${baseFileName}";`);
    }

    return { jsxComponents, tsxComponents, indexJsExports, indexTsExports, declarationFiles };
};

// Create npm package and publish to npm
const createAndPublishNpmPackage = async ({ projectName, jsxComponents, tsxComponents, indexJsExports, indexTsExports, declarationFiles }) => {
    const packageDir = path.join(__dirname, projectName);
    const distJsxDir = path.join(packageDir, 'dist', 'jsx');
    const distTsxDir = path.join(packageDir, 'dist', 'tsx');

    // Create directories
    fs.mkdirSync(distJsxDir, { recursive: true });
    fs.mkdirSync(distTsxDir, { recursive: true });

    // Write JSX and TSX components
    jsxComponents.forEach(({ fileName, content }) => {
        fs.writeFileSync(path.join(distJsxDir, fileName), content);
    });
    fs.writeFileSync(path.join(distJsxDir, 'index.js'), indexJsExports.join('\n'));

    tsxComponents.forEach(({ fileName, content }) => {
        fs.writeFileSync(path.join(distTsxDir, fileName), content);
    });
    fs.writeFileSync(path.join(distTsxDir, 'index.ts'), indexTsExports.join('\n'));

    // Write TypeScript declaration files
    declarationFiles.forEach(({ fileName, content }) => {
        fs.writeFileSync(path.join(distTsxDir, fileName), content);
    });

    // Create package.json
    const packageJsonContent = {
        name: projectName.toLowerCase(),
        // name: projectName.toLowerCase() + "-" + Date.now(),
        // name: 'fortestingpurposeonly',
        version: "1.0.0",
        main: "dist/jsx/index.js",
        types: "dist/tsx/index.d.ts",
        author: "Mrunal Patel",
        peerDependencies: {
            react: ">= 16",
            "react-dom": ">= 16"
        },
        devDependencies: {}
    };
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageJsonContent, null, 2));

    // Publish package to npm
    execSync(`npm publish ${packageDir} --access public`);

    // Clean up
    fs.rmdirSync(packageDir, { recursive: true });
};


// Endpoint to handle SVG to React component conversion and npm publishing
app.get('/publish', async (req, res) => {
    try {
        const projectId = req.query.projectId;
        const projectName = req.query.projectName || 'project';
        const page = req.query.page || 0;
        const perPage = req.query.perPage || 10;
        const sort = req.query.sort || '-iconId';

        console.log(`Received request to publish project: ${projectName} with ID: ${projectId}`);

        const svgFiles = await fetchSVGsForProject(projectId, page, perPage, sort);
        const { jsxComponents, tsxComponents, indexJsExports, indexTsExports, declarationFiles } = await convertSVGsToComponents(svgFiles);

        await createAndPublishNpmPackage({
            projectName,
            jsxComponents,
            tsxComponents,
            indexJsExports,
            indexTsExports,
            declarationFiles,
        });

        res.status(200).send('Package published to npm successfully');
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
