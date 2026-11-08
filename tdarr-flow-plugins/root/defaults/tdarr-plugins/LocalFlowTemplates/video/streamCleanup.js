'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "Stream Cleanup" (original flow _id: StreamCleanup_PENDING) on 2026-11-08.
// Template details() carry no _id; goToFlow nodes inside these flows reference other flows by their
// original _id, so a flow created from this file only works if Tdarr keeps those IDs (unverified).
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "name": "Stream Cleanup",
    "description": "Stream Cleanup",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Entry from Clean or Converter Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "scEntry",
        "position": {
          "x": 996,
          "y": -288
        }
      },
      {
        "name": "Begin Command",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandStart",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "scBegin",
        "position": {
          "x": 996,
          "y": -216
        }
      },
      {
        "name": "Remove images",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandRemoveStreamByProperty",
        "version": "1.0.0",
        "inputsDB": {
          "codecType": "any",
          "condition": "equals",
          "valuesToRemove": "attachment",
          "propertyToCheck": "codec_type"
        },
        "fpEnabled": true,
        "id": "scRemoveImages",
        "position": {
          "x": 996,
          "y": -144
        }
      },
      {
        "name": "Remove non-english audio",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandRemoveStreamByProperty",
        "version": "1.0.0",
        "inputsDB": {
          "codecType": "audio",
          "propertyToCheck": "tags.language",
          "valuesToRemove": "eng",
          "condition": "not_equals"
        },
        "fpEnabled": true,
        "id": "scRemoveAudio",
        "position": {
          "x": 996,
          "y": -84
        }
      },
      {
        "name": "Remove non-english subtitles",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandRemoveStreamByProperty",
        "version": "1.0.0",
        "inputsDB": {
          "codecType": "subtitle",
          "propertyToCheck": "tags.language",
          "valuesToRemove": "eng",
          "condition": "not_equals"
        },
        "fpEnabled": true,
        "id": "scRemoveSubs",
        "position": {
          "x": 996,
          "y": -12
        }
      },
      {
        "name": "Remove title metadata",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandCustomArguments",
        "version": "1.0.0",
        "inputsDB": {
          "outputArguments": "-map_metadata -1"
        },
        "fpEnabled": true,
        "id": "scRemoveTitle",
        "position": {
          "x": 996,
          "y": 72
        }
      },
      {
        "name": "🛫 Return to Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "WReQY_XGS",
          "pluginId": "retFromCleanup"
        },
        "fpEnabled": true,
        "id": "scReturnToController",
        "position": {
          "x": 996,
          "y": 216
        }
      },
      {
        "name": "Set Container",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetContainer",
        "version": "1.0.0",
        "inputsDB": {
          "container": "mkv",
          "forceConform": "true"
        },
        "fpEnabled": true,
        "id": "scSetContainer",
        "position": {
          "x": 996,
          "y": 144
        }
      }
    ],
    "flowEdges": [
      {
        "source": "scEntry",
        "sourceHandle": "1",
        "target": "scBegin",
        "targetHandle": null,
        "id": "scE2"
      },
      {
        "source": "scBegin",
        "sourceHandle": "1",
        "target": "scRemoveImages",
        "targetHandle": null,
        "id": "scE3"
      },
      {
        "source": "scRemoveImages",
        "sourceHandle": "1",
        "target": "scRemoveAudio",
        "targetHandle": null,
        "id": "scE4"
      },
      {
        "source": "scRemoveAudio",
        "sourceHandle": "1",
        "target": "scRemoveSubs",
        "targetHandle": null,
        "id": "scE5"
      },
      {
        "source": "scRemoveSubs",
        "sourceHandle": "1",
        "target": "scRemoveTitle",
        "targetHandle": null,
        "id": "scE6"
      },
      {
        "source": "scRemoveTitle",
        "sourceHandle": "1",
        "target": "scSetContainer",
        "targetHandle": null,
        "id": "scE10"
      },
      {
        "source": "scSetContainer",
        "sourceHandle": "1",
        "target": "scReturnToController",
        "targetHandle": null,
        "id": "scE11"
      }
    ]
  });
exports.details = details;
