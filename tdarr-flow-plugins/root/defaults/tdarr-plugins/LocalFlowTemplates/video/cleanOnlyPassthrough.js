'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "Clean only passthrough" (original flow _id: kASAOsE1n) on 2026-11-08.
// Template details() carry no _id; goToFlow nodes inside these flows reference other flows by their
// original _id, so a flow created from this file only works if Tdarr keeps those IDs (unverified).
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "name": "Clean only passthrough",
    "description": "Clean only passthrough",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Entry from Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "YWo6oScBV",
        "position": {
          "x": 384,
          "y": 192
        }
      },
      {
        "name": "Execute",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandExecute",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "Vl1U5eT5F",
        "position": {
          "x": 384,
          "y": 252
        }
      },
      {
        "name": "🛫 Returning to Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "id": "VHoKMuJNh",
        "inputsDB": {
          "flowId": "WReQY_XGS",
          "pluginId": "retFromClean"
        },
        "fpEnabled": true,
        "position": {
          "x": 384,
          "y": 312
        }
      }
    ],
    "flowEdges": [
      {
        "source": "Vl1U5eT5F",
        "sourceHandle": "1",
        "target": "VHoKMuJNh",
        "targetHandle": null,
        "id": "qQscApkze"
      },
      {
        "source": "YWo6oScBV",
        "sourceHandle": "1",
        "target": "Vl1U5eT5F",
        "targetHandle": null,
        "id": "cE6"
      }
    ]
  });
exports.details = details;
