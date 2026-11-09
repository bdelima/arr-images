'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "Clean only passthrough" (original flow _id: kASAOsE1n) on 2026-11-08, then changed so that the remux is the mkvmerge Execute plugin (mkvmergeExecute, mode all) instead of ffmpegCommandExecute.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Whether Tdarr keeps an _id given here when a flow is created from this file (Add Flow > Local) is unverified;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "kASAOsE1n",
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
        "name": "mkvmerge remux",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "all",
          "source": "working"
        },
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
          "flowId": "HWxfel7zZ",
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
