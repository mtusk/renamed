#!/usr/bin/env node

var program = require('commander');
var path = require('path');
var fs = require('fs-extra')
var inquirer = require('inquirer');
var pluralize = require('pluralize');
var chalk = require('chalk');
var Table = require('easy-table');
var _ = require('lodash');
var junk = require('junk');

const write = message => process.stdout.write(message);
const writeLine = console.log;
const error = message => writeLine(chalk.bold.red(message));
const success = message => writeLine(chalk.green(message));
const defaultFileName = 'renamed.json';

program.version('0.0.1');

program
  .command('export')
  .description('Write current working directory\s files to the specified output file')
  .arguments('[outputFile]')
  .action(outputFile => {
    if (!outputFile) {
      outputFile = defaultFileName;
    }

    const outputFileExtension = path.extname(outputFile);
    if (outputFileExtension) {
      if (outputFileExtension !== '.json') {
        const errorMessage = 'outputFile extension must be \'.json\' if provided. (\'.json\' will be used if none is provided)';
        error(error);
      }
    } else {
      outputFile += '.json';
    }

    const cwd = process.cwd();
    const absoluteOutputFile = path.resolve(outputFile);
    const relativeOutputFile = path.relative(cwd, absoluteOutputFile);

    write('Collecting file names...');
    const currentFileNames = getCurrentFileNames(cwd).filter(file => {
      const absoluteFile = path.resolve(file);
      return absoluteFile !== absoluteOutputFile;
    });

    const json = JSON.stringify(currentFileNames, null, 2);
    process.stdout.write(chalk.green(' done'));
    write('\n');

    write('Writing file names...');
    fs.writeFileSync(absoluteOutputFile, json);
    write(chalk.green(' done'));
    write('\n');

    writeLine();
    writeLine(`You can now modify '${chalk.blue(relativeOutputFile)}' in your favorite text editor to the desired file names then run 'import'`);
  });

program
  .command('import')
  .description('Renames files in the current working directory based on the input file')
  .arguments('[inputFile]')
  .action(inputFile => {
    if (!inputFile) {
      inputFile = defaultFileName;

      writeLine(`Using default file name: ${chalk.blue(defaultFileName)}`);
      writeLine();
    }

    const cwd = process.cwd();
    const absoluteInputFile = path.resolve(inputFile);
    const currentFileNames = getCurrentFileNames(cwd).filter(file => {
      const absoluteFile = path.resolve(file);
      return absoluteFile !== absoluteInputFile;
    });

    const newFileNamesJson = fs.readFileSync(absoluteInputFile).toString();
    const newFileNames = JSON.parse(newFileNamesJson).filter(file => {
      const absoluteFile = path.resolve(file);
      return absoluteFile !== absoluteInputFile;
    });

    if (currentFileNames.length !== newFileNames.length) {
      const errorMessage = `${inputFile} does not have the correct number of file names.`;
      error(`${errorMessage} Expected ${currentFileNames.length}, found ${newFileNames.length}.`);

      throw new Error(errorMessage);
    }

    const duplicates = _(newFileNames).groupBy().pickBy(x => x.length > 1).keys().value();
    if (duplicates.length > 0) {
      error('Files already exist for the following renames:');
      duplicates.forEach(duplicate => {
        error(`- ${duplicate}`);
      });

      throw new Error('EEXIST Unable to rename because files already exist with the target names.');
    }

    const differences = getDifferences(currentFileNames, newFileNames);

    if (differences.length === 0) {
      success('No files found to rename.');

      writeLine();

      cleanup(inputFile, absoluteInputFile);

      return;
    }

    writeLine('Renames to be performed:');
    writeLine();
    displayDifferences(differences);

    const confirmationMessage = `Are you sure you want to rename ${pluralize('these', differences.length)} ${differences.length} ${pluralize('file', differences.length)}?`;
    const confirmedKey = 'confirmed';

    inquirer
      .prompt([{
        type: 'confirm',
        name: confirmedKey,
        message: confirmationMessage,
        default: false
      }])
      .then(result => {
        const confirmed = result[confirmedKey];

        if (!confirmed) {
          writeLine();
          writeLine('Rename aborted');
          return;
        }

        rename(differences);

        success(`${differences.length} ${pluralize('files', differences.length)} renamed.`);
        writeLine();

        cleanup(inputFile, absoluteInputFile);
      })
      .catch(error => {
        error(error);
        throw new Error(error);
      });
  });

program.parse(process.argv);

function getDifferences(oldNames, newNames, excludedFiles) {
  const differences = [];

  for (i = 0; i < oldNames.length; i++) {
    if (i >= newNames.length) {
      break;
    }

    const from = oldNames[i];
    const to = newNames[i];

    const valueChanged = from !== to;
    const isExcluded = excludedFiles && excludedFiles.includes(from);
    if (valueChanged && !isExcluded) {
      differences.push({
        i: i,
        from: from,
        to: to
      });
    }
  }

  return differences;
}

function displayDifferences(differences) {
  var table = new Table();

  differences.forEach(difference => {
    table.cell('', difference.i, Table.number());
    table.cell('From', chalk.red(difference.from));
    table.cell('To', chalk.green(difference.to));
    table.newRow();
  });

  writeLine(table.toString());
}

function rename(differences) {
  differences.forEach(difference => {
    const from = path.resolve(difference.from);
    const to = path.resolve(difference.to);

    // fs-extra moveSync creates directories as needed (whereas fs renameSync does not)
    fs.moveSync(from, to);
  });
}

function walk(dir, depth, root) {
  if (!depth) {
    depth = 0;
  }
  if (!root) {
    root = dir;
  }

  var results = [];
  var list = fs.readdirSync(dir).filter(junk.not);
  list.forEach(function (file) {
    file = dir + '/' + file;
    var stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      /* Recurse into a subdirectory */
      results = results.concat(walk(file, depth + 1, root));
    } else {
      /* Is a file */
      const relativeFilePath = `.${path.sep}${path.relative(root, file)}`;
      results.push({
        relativeFilePath: relativeFilePath,
        depth: depth,
        root: root
      });

      if (results.length > 5000) {
        throw new Error('Too many files!');
      }
    }
  });
  return results;
}

function getCurrentFileNames(cwd) {
  const currentFileNames = _(walk(cwd))
    .sortBy('depth')
    .map('relativeFilePath')
    .value();

  return currentFileNames;
}

function cleanup(inputFile, absoluteInputFile) {
  const confirmedKey = 'confirmed';

  inquirer
    .prompt([{
      type: 'confirm',
      name: confirmedKey,
      message: `Delete ${chalk.blue(inputFile)}?`,
      default: true
    }])
    .then(result => {
      const confirmed = result[confirmedKey];

      if (confirmed) {
        fs.unlinkSync(absoluteInputFile);
      }
    });
}
