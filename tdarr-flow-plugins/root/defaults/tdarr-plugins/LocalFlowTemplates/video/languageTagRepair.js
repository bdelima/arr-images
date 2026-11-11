'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Language tag repair, for files the old pipeline already processed. Until 0.3.0 the Stream Cleanup remux used
// ffmpeg -map_metadata -1, which left every audio and subtitle track of the output with language "und". This flow puts the
// language back (eng by default) with mkvpropedit, in place on the file, and ONLY on a file that has the damage
// signature (written by ffmpeg/libavformat AND with an audio track that has no language). Any other file finishes with no change.
// It is a standalone flow: point a library at it (a library built from the Tdarr history list of processed files), do not call it from the Controller.
// It edits the library file itself, not a copy; run it on a library whose files are expected to be changed in place.
// This flow is not exported from a live Tdarr flow; it was written for this repo. Its _id is fixed so that importing it again over
// an existing copy (Import JSON Flow Template > Replace) updates that flow in place.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "LangTagRepair",
    "name": "Repair language tags",
    "description": "Sets language eng on untagged audio and subtitle tracks of files written by ffmpeg (damage signature); changes nothing else",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Input File",
        "sourceRepo": "Community",
        "pluginName": "inputFile",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "langInput",
        "position": {
          "x": 384,
          "y": 192
        }
      },
      {
        "name": "Route to local CPU",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "local"
        },
        "fpEnabled": true,
        "id": "langRequeue",
        "position": {
          "x": 384,
          "y": 252
        }
      },
      {
        "name": "Repair language tags",
        "sourceRepo": "Local",
        "pluginName": "repairLanguageTags",
        "version": "1.0.0",
        "inputsDB": {
          "language": "eng",
          "encoderPrefix": "Lavf",
          "dryRun": "false"
        },
        "fpEnabled": true,
        "id": "langRepair",
        "position": {
          "x": 384,
          "y": 312
        }
      }
    ],
    "flowEdges": [
      {
        "source": "langInput",
        "sourceHandle": "1",
        "target": "langRequeue",
        "targetHandle": null,
        "id": "langEdge1"
      },
      {
        "source": "langRequeue",
        "sourceHandle": "1",
        "target": "langRepair",
        "targetHandle": null,
        "id": "langEdge2"
      }
    ]
  });
exports.details = details;
