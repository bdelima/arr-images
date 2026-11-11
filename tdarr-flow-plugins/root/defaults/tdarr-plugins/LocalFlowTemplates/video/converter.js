'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "264 to 265 Converter" (originally _id YEZ9GlGHp, now 20ZN6oc41) on 2026-11-08, then changed so that every remux step is the mkvmerge Execute plugin (mkvmergeExecute) instead of ffmpeg: the
// Remove video streams node is gone (audioSubs mode leaves video out) and Entry goes straight to the audio+subs step.
// Brought up to the live "Converter (0.6.0)" on 2026-11-10 (the name carries the template's own version, see the README; the live flow is
// now called "Converter"). Changes from that update: the "Route to local CPU (demux path)" and "Mark step:
// landed on local (demux)" nodes are gone, so "Mark step: encode done" leads straight into the final mkvmerge combine; node positions moved.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "20ZN6oc41",
    "name": "Converter (0.6.1)",
    "description": "Converter",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Entry from Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "X4ANCc9vI",
        "position": {
          "x": 456,
          "y": 192
        }
      },
      {
        "name": "mkvmerge (audio+subs only)",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "audioSubs",
          "source": "working"
        },
        "fpEnabled": true,
        "id": "JTeKdNnFR",
        "position": {
          "x": 456,
          "y": 264
        }
      },
      {
        "name": "Preserve audio+subs (stable path)",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "userCli": "mkvmerge",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "true",
          "userOutputFilePath": "/temp/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv",
          "cliArguments": "-c mkdir -p \"/temp/.tdarr-remux-cache\"; cp \"{{{args.inputFileObj._id}}}\" \"${outputFilePath}\"",
          "outputFileBecomesWorkingFile": "false"
        },
        "fpEnabled": true,
        "id": "IBXuDL7Dx",
        "position": {
          "x": 456,
          "y": 312
        }
      },
      {
        "name": "mkvmerge (video from original)",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "video",
          "source": "original"
        },
        "fpEnabled": true,
        "id": "tpYlSXpfK",
        "position": {
          "x": 456,
          "y": 360
        }
      },
      {
        "name": "Route to encoder (GPU)",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "encoder"
        },
        "fpEnabled": true,
        "id": "tHF4vUCsM",
        "position": {
          "x": 456,
          "y": 408
        }
      },
      {
        "name": "Begin Command (encode)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandStart",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "ehGAkWvj7",
        "position": {
          "x": 720,
          "y": 336
        }
      },
      {
        "name": "Set Video Encoder",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandSetVideoEncoder",
        "version": "1.0.0",
        "inputsDB": {
          "outputCodec": "hevc",
          "ffmpegPresetEnabled": "true",
          "ffmpegPreset": "slow",
          "ffmpegQualityEnabled": "true",
          "ffmpegQuality": "18",
          "hardwareEncoding": "true",
          "hardwareType": "qsv",
          "hardwareDecoding": "true",
          "forceEncoding": "true"
        },
        "fpEnabled": true,
        "id": "FAc9QeWJK",
        "position": {
          "x": 720,
          "y": 384
        }
      },
      {
        "name": "Set Source-Relative Bitrate",
        "sourceRepo": "Local",
        "pluginName": "setSourceRelativeBitrate",
        "version": "1.0.0",
        "inputsDB": {
          "enabled": "true",
          "targetPercent": "70",
          "ceilingBasis": "peak",
          "ceilingPercent": "100",
          "bufsizeMultiplier": "2",
          "minTargetKbps": "300",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "srcRelCap",
        "position": {
          "x": 720,
          "y": 432
        }
      },
      {
        "name": "Tag Encode Settings",
        "sourceRepo": "Local",
        "pluginName": "tagEncodeSettings",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "d7QK1TBlh",
        "position": {
          "x": 720,
          "y": 468
        }
      },
      {
        "name": "Execute (encode)",
        "sourceRepo": "Community",
        "pluginName": "ffmpegCommandExecute",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "Y40uvSwMF",
        "position": {
          "x": 720,
          "y": 504
        }
      },
      {
        "name": "mkvmerge (final combine)",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "combine",
          "audioSubsDir": "/temp/.tdarr-remux-cache"
        },
        "fpEnabled": true,
        "id": "SQedUStPK",
        "position": {
          "x": 456,
          "y": 552
        }
      },
      {
        "name": "Cleanup audio+subs cache file",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "userCli": "mkvmerge",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "cliArguments": "-c rm -f \"/temp/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv\"",
          "outputFileBecomesWorkingFile": "false"
        },
        "fpEnabled": true,
        "id": "R0CsTy4Qw",
        "position": {
          "x": 456,
          "y": 588
        }
      },
      {
        "name": "🛫 Returning to Controller Flow",
        "sourceRepo": "Community",
        "pluginName": "goToFlow",
        "version": "2.0.0",
        "inputsDB": {
          "flowId": "HWxfel7zZ",
          "pluginId": "retFromConv"
        },
        "fpEnabled": true,
        "id": "b8n51xYj4",
        "position": {
          "x": 456,
          "y": 636
        }
      },
      {
        "name": "Mark step: landed on encoder",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-start"
        },
        "fpEnabled": true,
        "id": "cnvMarkEnc",
        "position": {
          "x": 720,
          "y": 288
        }
      },
      {
        "name": "Mark step: encode done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-done"
        },
        "fpEnabled": true,
        "id": "cnvMarkEncDone",
        "position": {
          "x": 720,
          "y": 552
        }
      }
    ],
    "flowEdges": [
      {
        "source": "JTeKdNnFR",
        "sourceHandle": "1",
        "target": "IBXuDL7Dx",
        "targetHandle": null,
        "id": "mTVJWcMTG"
      },
      {
        "source": "IBXuDL7Dx",
        "sourceHandle": "1",
        "target": "tpYlSXpfK",
        "targetHandle": null,
        "id": "3VXdY7ayD"
      },
      {
        "source": "tpYlSXpfK",
        "sourceHandle": "1",
        "target": "tHF4vUCsM",
        "targetHandle": null,
        "id": "3ezWKl2To"
      },
      {
        "source": "tHF4vUCsM",
        "sourceHandle": "1",
        "target": "cnvMarkEnc",
        "targetHandle": null,
        "id": "q9SMuVcpy"
      },
      {
        "source": "ehGAkWvj7",
        "sourceHandle": "1",
        "target": "FAc9QeWJK",
        "targetHandle": null,
        "id": "jtU5s0GZJ"
      },
      {
        "source": "FAc9QeWJK",
        "sourceHandle": "1",
        "target": "srcRelCap",
        "targetHandle": null,
        "id": "F8KgIMdGM"
      },
      {
        "source": "srcRelCap",
        "sourceHandle": "1",
        "target": "d7QK1TBlh",
        "targetHandle": null,
        "id": "capToTag"
      },
      {
        "source": "d7QK1TBlh",
        "sourceHandle": "1",
        "target": "Y40uvSwMF",
        "targetHandle": null,
        "id": "tagToExecute"
      },
      {
        "source": "Y40uvSwMF",
        "sourceHandle": "1",
        "target": "cnvMarkEncDone",
        "targetHandle": null,
        "id": "Vu9HtsSNH"
      },
      {
        "source": "SQedUStPK",
        "sourceHandle": "1",
        "target": "R0CsTy4Qw",
        "targetHandle": null,
        "id": "euQAg3ePe"
      },
      {
        "source": "R0CsTy4Qw",
        "sourceHandle": "1",
        "target": "b8n51xYj4",
        "targetHandle": null,
        "id": "O0ZWCGN8b"
      },
      {
        "source": "X4ANCc9vI",
        "sourceHandle": "1",
        "target": "JTeKdNnFR",
        "targetHandle": null,
        "id": "vE6"
      },
      {
        "source": "cnvMarkEnc",
        "sourceHandle": "1",
        "target": "ehGAkWvj7",
        "targetHandle": null,
        "id": "q9SMuVcpyb"
      },
      {
        "source": "cnvMarkEncDone",
        "sourceHandle": "1",
        "target": "SQedUStPK",
        "targetHandle": null,
        "id": "BPr3K1ven"
      }
    ]
  });
exports.details = details;
