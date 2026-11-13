'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Exported verbatim from the live Tdarr flow "264 to 265 Converter" (originally _id YEZ9GlGHp, now 20ZN6oc41) on 2026-11-08, then changed so that every remux step is the mkvmerge Execute plugin (mkvmergeExecute) instead of ffmpeg: the
// Remove video streams node is gone (audioSubs mode leaves video out) and Entry goes straight to the audio+subs step.
// Brought up to the live "Converter (0.6.0)" on 2026-11-10 (the build stamps the template's version onto the name, so the name here stays
// plain; the live flow is now called "Converter"). Changes from that update: the "Route to local CPU (demux path)" and "Mark step:
// landed on local (demux)" nodes are gone, so "Mark step: encode done" leads straight into the final mkvmerge combine; node positions moved.
// Brought up to the live "Converter (v11)" on 2026-11-11: after "Mark step: encode done" new "Route to mapped nodes" (Tags: Worker Type, CPU worker on a node tagged mapped) and
// "Mark step: landed on mapped node" (label converter-encode-mapped) come before the final mkvmerge combine, so an encode that ran on an unmapped node goes back to a mapped node,
// which downloads the encoded file from the server, before the combine reads the shared remux cache. "Route to encoder (GPU)" is renamed "Route to encoder nodes"; node positions moved.
// Quality tier, 2026-11-12: "Set Source-Relative Bitrate" (the QVBR cap) is replaced by "Set Quality With Node Offset", which adds the encode node's offset to the baseline quality (the Flow Variable
// tdarrQuality from the Controller's "Set Encode Quality", else the number Set Video Encoder wrote) and still records the source average and peak bitrate for the output tags. No bitrate cap is set.
// The template ships drakebay-gpu=-3: on one 1080p50 source, drakebay ICQ 28 gave 4478 kbps and ojochal ICQ 31 gave 4389 kbps, at near-equal VMAF.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "20ZN6oc41",
    "name": "Converter",
    "description": "Converter",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Mark step: landed on mapped node",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "converter-encode-mapped"
        },
        "fpEnabled": true,
        "id": "qwYEerynw",
        "position": {
          "x": 456,
          "y": 552
        }
      },
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
        "name": "Route to encoder nodes",
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
          "y": 372
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
          "y": 420
        }
      },
      {
        "name": "Set Quality With Node Offset",
        "sourceRepo": "Local",
        "pluginName": "setQualityWithNodeOffset",
        "version": "1.0.0",
        "inputsDB": {
          "nodeOffsets": "drakebay-gpu=-3",
          "peakWindowSeconds": "2",
          "peakPercentile": "100",
          "peakScanTimeoutSeconds": "300",
          "assumedAudioKbps": "256"
        },
        "fpEnabled": true,
        "id": "qualOffset",
        "position": {
          "x": 720,
          "y": 468
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
          "y": 504
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
          "y": 540
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
          "y": 600
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
          "y": 636
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
          "y": 684
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
          "y": 324
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
          "y": 588
        }
      },
      {
        "name": "Route to mapped nodes",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "id": "qyqzR1Ocm",
        "position": {
          "x": 456,
          "y": 516
        },
        "fpEnabled": true,
        "inputsDB": {
          "requiredNodeTags": "mapped",
          "requiredWorkerType": "CPU"
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
        "target": "qualOffset",
        "targetHandle": null,
        "id": "F8KgIMdGM"
      },
      {
        "source": "qualOffset",
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
        "target": "qyqzR1Ocm",
        "targetHandle": null,
        "id": "spm0GzRIZ"
      },
      {
        "source": "qyqzR1Ocm",
        "sourceHandle": "1",
        "target": "qwYEerynw",
        "targetHandle": null,
        "id": "dZY17ylsS"
      },
      {
        "source": "SQedUStPK",
        "sourceHandle": "1",
        "target": "R0CsTy4Qw",
        "targetHandle": null,
        "id": "_zXcfY6xK"
      },
      {
        "source": "qwYEerynw",
        "sourceHandle": "1",
        "target": "SQedUStPK",
        "targetHandle": null,
        "id": "4oldrn25C"
      }
    ]
  });
exports.details = details;
