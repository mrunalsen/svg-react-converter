const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const azdev = require("azure-devops-node-api");
const { BuildApi } = require('azure-devops-node-api/BuildApi');

const app = express();
const port = process.env.PORT || 1000;
app.use(cors());

const organizationUrl = 'https://vssps.dev.azure.com/1RivetUSInc';
const projectName = '1Rivet_Artifactory';
const feedName = '1RivetUSInc';
const token = 'ajZhejJ1cXRmZzJkaXViN2dpaXB5eXRxYndxYng1bmJ2am9rZGp6MndpandmcGcycjJtYQ==';

// let token = process.env.AZURE_PERSONAL_ACCESS_TOKEN;
let authHandler = azdev.getPersonalAccessTokenHandler(token);
// console.log(authHandler);
let connection = new azdev.WebApi(organizationUrl, authHandler);
console.log(connection);
const projectApi = connection.getBuildApi();
console.log(projectApi);
// const getbuild = new BuildApi
// console.log(connection.getProfileApi());


const fetchSVGsForProject = async (projectId, page, perPage, sort) => {
    console.log(`Fetching SVGs for project ${projectId} with page: ${page}, perPage: ${perPage}, sort: ${sort}`);
    const response = await axios.post(`http://172.16.0.5:8088/api/project/${projectId}/icons`, {
        params: { page, perPage, sort }
    });

    const icons = response?.data?.result?.icons || [];

    const svgFiles = {};

    for (const icon of icons) {
        for (const iconImage of icon.iconImages) {
            const svgResponse = await axios.get(`http://172.16.0.5:8088/${iconImage.iconImagePath}`, {
                responseType: 'text'
            });
            svgFiles[iconImage.imageName] = svgResponse.data;
        }
    }

    return svgFiles;
};

const convertSVGsToComponents = async (svgFiles) => {
    const jsxComponents = [];
    const tsxComponents = [];
    const indexJsExports = [];
    const indexTsExports = [];
    const declarationFiles = [];

    const toPascalCase = (str) => {
        return str
            .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
            .replace(/^./, (c) => c.toUpperCase());
    };

    for (const fileName in svgFiles) {
        const svg = svgFiles[fileName];
        const baseFileName = toPascalCase(fileName.replace('.svg', ''));

        const cleanedSVG = svg.replace(/<svg[^>]*>/, (match) => {
            return match
                .replace(/\sid="[^"]*"/, '')
                .replace(/\sheight="[^"]*"/, '')
                .replace(/\swidth="[^"]*"/, '')
                .replace(/\sviewBox="[^"]*"/, ' viewBox="0 0 512 512"')
                .replace(/\senable-background="[^"]*"/, '')
                .replace(/\scolor="[^"]*"/, ' color="black"');
        });

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

        jsxComponents.push({ fileName: `${fileName.replace('.svg', '')}.jsx`, content: jsxComponent });
        tsxComponents.push({ fileName: `${fileName.replace('.svg', '')}.tsx`, content: tsxComponent });
        declarationFiles.push({ fileName: `${fileName.replace('.svg', '')}.d.ts`, content: declarationFile });
        indexJsExports.push(`export { default as ${baseFileName} } from "./${baseFileName}";`);
        indexTsExports.push(`export { default as ${baseFileName} } from "./${baseFileName}";`);
    }

    return { jsxComponents, tsxComponents, indexJsExports, indexTsExports, declarationFiles };
};

const createAndPublishAzurePackage = async ({ projectName, jsxComponents, tsxComponents, indexJsExports, indexTsExports, declarationFiles }) => {
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
        // name: projectName.toLowerCase() + "-" + Date.now(),
        name: 'fortestingpurposeonly',
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
    const tarballName = `${projectName.toLowerCase()}-${Date.now()}.tgz`;
    const tarballPath = path.join(packageDir, tarballName);

    execSync(`cd ${packageDir} && npm pack`);

    const packagingApi = (await connection.getBuildApi()).createArtifact();

    try {
        const uploadResult = await packagingApi.publishPackageToFeed(
            projectName,
            feedName,
            fs.createReadStream(tarballPath),
            projectName
        );

        console.log('Package uploaded successfully:', uploadResult);
    } catch (error) {
        console.error('Error uploading package:', error);
    } finally {
        fs.unlinkSync(tarballPath);
        fs.rmdirSync(packageDir, { recursive: true });
    }
};

app.post('/publish', async (req, res) => {
    try {
        // const { projectId, projectName, page, perPage, sort } = req.body;
        const projectId = 72;
        const projectName = 'arielinvestments';
        const page = 0;
        const perPage = 100;
        const sort = "-iconId";

        const svgFiles = await fetchSVGsForProject(projectId, page, perPage, sort);
        const { jsxComponents, tsxComponents, indexJsExports, indexTsExports, declarationFiles } = await convertSVGsToComponents(svgFiles);

        await createAndPublishAzurePackage({
            projectName,
            jsxComponents,
            tsxComponents,
            indexJsExports,
            indexTsExports,
            declarationFiles
        });

        res.status(200).json({ message: 'Package published to Azure Artifacts successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
